# Prepare CPIH MM23 data for a PrimeReact TreeSelect
# ---------------------------------------------------
# What this script does:
# 1) Downloads the current MM23 workbook from ONS
# 2) Detects the relevant sheet and header row automatically
# 3) Keeps MONTH YEAR plus CPIH index columns rebased to 2015=100
# 4) Creates user-friendly CPIH item names
# 5) Builds nested TreeNode objects for PrimeReact TreeSelect
# 6) Writes out a plotting dataset and a tree JSON file

packages <- c(
  "readxl", "dplyr", "tidyr", "purrr", "stringr", "tibble", "jsonlite"
)

missing_pkgs <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_pkgs) > 0) {
  install.packages(missing_pkgs, repos = "https://cloud.r-project.org")
}

library(readxl)
library(dplyr)
library(tidyr)
library(purrr)
library(stringr)
library(tibble)
library(jsonlite)

mm23_url <- "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/consumerpriceindices/current/mm23.xlsx"
out_dir <- "static/data"
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

xlsx_path <- file.path(out_dir, "mm23.xlsx")
if (!file.exists(xlsx_path)) {
  download.file(mm23_url, destfile = xlsx_path, mode = "wb", quiet = FALSE)
}

#---- Helpers -----------------------------------------------------------------

find_mm23_sheet <- function(path, max_rows = 30) {
  sheets <- readxl::excel_sheets(path)

  score_sheet <- function(sheet) {
    probe <- suppressMessages(
      readxl::read_excel(path, sheet = sheet, n_max = max_rows, col_names = FALSE)
    )

    vals <- as.character(unlist(probe, use.names = FALSE))
    vals <- vals[!is.na(vals)]

    sum(vals == "MONTH YEAR") +
      sum(str_detect(vals, "^CPIH(?:\\s+INDEX)?\\b"))
  }

  scores <- map_int(sheets, score_sheet)
  sheets[[which.max(scores)]]
}

find_header_row <- function(path, sheet, max_rows = 40) {
  probe <- suppressMessages(
    readxl::read_excel(path, sheet = sheet, n_max = max_rows, col_names = FALSE)
  )

  row_scores <- apply(probe, 1, function(x) {
    x <- as.character(x)
    sum(!is.na(x) & (x == "MONTH YEAR" | str_detect(x, "^CPIH(?:\\s+INDEX)?\\b")))
  })

  which.max(row_scores)
}

clean_desc <- function(x) {
  x %>%
    str_replace_all("&", " and ") %>%
    str_replace_all("\\bHH\\b", "household") %>%
    str_replace_all("\\bFURN\\b", "furniture") %>%
    str_replace_all("\\bEQUIP\\b", "equipment") %>%
    str_replace_all("\\bmisc\\.\\b", "miscellaneous") %>%
    str_replace_all("\\bMISC\\b", "miscellaneous") %>%
    str_replace_all("\\bPREPS\\b", "preparations") %>%
    str_replace_all("\\bincl\\b", "including") %>%
    str_replace_all("\\bnec\\b", "NEC") %>%
    str_replace_all("\\bn\\.e\\.c\\.\\b", "NEC") %>%
    str_replace_all("\\btelefax\\b", "telefax") %>%
    str_replace_all("\\bOOH\\b", "owner occupiers' housing") %>%
    str_replace_all("(?<=,)(?=[^[:space:]])", " ") %>%
    str_replace_all("(?<=:)(?=[^[:space:]])", " ") %>%
    str_squish() %>%
    str_to_lower() %>%
    tools::toTitleCase() %>%
    str_replace_all("Nec", "NEC") %>%
    str_replace_all("And", "and") %>%
    str_replace_all("Of", "of") %>%
    str_replace_all("For", "for") %>%
    str_replace_all("By", "by") %>%
    str_replace_all("In", "in") %>%
    str_replace_all("Outdoor", "Outdoor") %>%
    str_squish()
}

parse_cpih_column <- function(x) {
  stripped <- x %>%
    str_replace("\\s*2015=100\\s*$", "") %>%
    str_replace("^CPIH\\s+INDEX\\s*", "") %>%
    str_replace("^CPIH\\s*", "") %>%
    str_squish()

  if (stripped %in% c("Goods", "Services")) {
    code <- stripped
    desc <- stripped
  } else if (str_detect(stripped, "^[^:]+\\s*:")) {
    code <- str_trim(str_extract(stripped, "^[^:]+(?=\\s*:)") )
    desc <- str_trim(str_replace(stripped, "^[^:]+\\s*:\\s*", ""))
  } else {
    code <- word(stripped, 1)
    desc <- str_trim(str_remove(stripped, "^\\S+\\s*"))
  }

  friendly_name <- dplyr::case_when(
    code == "00" ~ "All items",
    TRUE ~ clean_desc(desc)
  )

  display_label <- dplyr::case_when(
    code == "00" ~ "Overall CPIH (All items)",
    code %in% c("Goods", "Services") ~ friendly_name,
    TRUE ~ paste(code, friendly_name)
  )

  depth <- if (code %in% c("00", "Goods", "Services")) {
    0L
  } else {
    str_count(code, fixed(".")) + 1L
  }

  level <- dplyr::case_when(
    code %in% c("00", "Goods", "Services") ~ "aggregate",
    depth == 1L ~ "division",
    depth == 2L ~ "group",
    depth == 3L ~ "class",
    TRUE ~ "subclass"
  )

  tibble(
    key = code,
    code = code,
    friendly_name = friendly_name,
    display_label = display_label,
    level = level
  )
}

expand_parent_prefixes <- function(code) {
  if (!str_detect(code, "/")) {
    return(code)
  }

  parts <- str_split(code, "\\.", simplify = TRUE)
  parts <- parts[parts != ""]
  last_part <- tail(parts, 1)
  stem <- head(parts, -1)

  if (!str_detect(last_part, "/")) {
    return(code)
  }

  opts <- str_split(last_part, "/", simplify = TRUE)
  opts <- opts[opts != ""]

  vapply(opts, function(opt) {
    paste(c(stem, opt), collapse = ".")
  }, character(1))
}

code_depth <- function(code) {
  if (code %in% c("00", "Goods", "Services")) return(0L)
  str_count(code, fixed(".")) + 1L
}

covers_code <- function(parent, child) {
  if (is.na(parent) || parent == child) return(FALSE)
  if (parent %in% c("00", "Goods", "Services")) return(FALSE)

  prefixes <- expand_parent_prefixes(parent)

  any(vapply(prefixes, function(prefix) {
    identical(child, prefix) || startsWith(child, paste0(prefix, "."))
  }, logical(1)))
}

find_parent_code <- function(code, all_codes) {
  candidates <- setdiff(all_codes, code)
  candidates <- candidates[vapply(candidates, covers_code, logical(1), child = code)]

  if (length(candidates) == 0) {
    return(NA_character_)
  }

  candidate_depths <- vapply(candidates, code_depth, integer(1))
  candidates[[which.max(candidate_depths)]]
}

build_tree_nodes <- function(nodes_df, parent = NA_character_) {
  kids <- if (is.na(parent)) {
    nodes_df %>% filter(is.na(parent_code))
  } else {
    nodes_df %>% filter(parent_code == parent)
  }

  if (nrow(kids) == 0) {
    return(list())
  }

  kids <- kids %>% arrange(order_id)

  purrr::map(seq_len(nrow(kids)), function(i) {
    row <- kids[i, ]
    child_nodes <- build_tree_nodes(nodes_df, parent = row$key)

    node <- list(
      key = row$key[[1]],
      label = row$display_label[[1]],
      selectable = TRUE,
      data = list(
        code = row$code[[1]],
        name = row$friendly_name[[1]],
        level = row$level[[1]],
        column_name = row$column_name[[1]]
      )
    )

    if (length(child_nodes) > 0) {
      node$children <- child_nodes
    } else {
      node$leaf <- TRUE
    }

    node
  })
}

#---- Read the workbook --------------------------------------------------------

sheet_name <- find_mm23_sheet(xlsx_path)
header_row <- find_header_row(xlsx_path, sheet_name)

raw_mm23 <- suppressMessages(
  readxl::read_excel(
    xlsx_path,
    sheet = sheet_name,
    skip = header_row - 1,
    .name_repair = "minimal"
  )
)

# Keep MONTH YEAR + CPIH index columns rebased to 2015=100.
# This matches the detailed CPIH item structure used for chart selection,
# while excluding annual rates, monthly rates and weights.
index_cols <- names(raw_mm23)[
  str_detect(names(raw_mm23), "^CPIH(?:\\s+INDEX)?\\b") &
    str_detect(names(raw_mm23), "2015=100\\s*$") &
    !str_detect(names(raw_mm23), regex("ANNUAL RATE|MONTHLY RATE|WEIGHTS", ignore_case = TRUE))
]

selected_cols <- c("MONTH YEAR", index_cols)
missing_selected_cols <- setdiff(selected_cols, names(raw_mm23))
if (length(missing_selected_cols) > 0) {
  warning(
    "These expected columns were not found: ",
    paste(missing_selected_cols, collapse = ", ")
  )
}

cpih_wide <- raw_mm23 %>%
  select(any_of(selected_cols))

#---- Tidy data with user-friendly metadata -----------------------------------

series_meta <- tibble(column_name = index_cols, order_id = seq_along(index_cols)) %>%
  bind_cols(map_dfr(index_cols, parse_cpih_column)) %>%
  mutate(parent_code = map_chr(code, find_parent_code, all_codes = code))

cpih_long <- cpih_wide %>%
  pivot_longer(
    cols = -`MONTH YEAR`,
    names_to = "column_name",
    values_to = "value"
  ) %>%
  left_join(series_meta, by = "column_name") %>%
  rename(month_year = `MONTH YEAR`) %>%
  select(month_year, key, code, friendly_name, display_label, level, value, column_name)

#---- PrimeReact TreeSelect nodes ---------------------------------------------

tree_nodes <- build_tree_nodes(series_meta)

#---- Save outputs -------------------------------------------------------------

write_csv_safe <- function(data, path) {
  utils::write.csv(data, path, row.names = FALSE, na = "")
}

write_csv_safe(cpih_wide, file.path(out_dir, "cpih_selected_wide.csv"))
write_csv_safe(cpih_long, file.path(out_dir, "cpih_selected_long.csv"))
write_csv_safe(series_meta, file.path(out_dir, "cpih_series_metadata.csv"))

jsonlite::write_json(
  tree_nodes,
  path = file.path(out_dir, "cpih_tree_nodes.json"),
  pretty = TRUE,
  auto_unbox = TRUE,
  null = "null"
)

# Optional: an example value object for PrimeReact checkbox mode
example_selection <- list(
  "00" = list(checked = TRUE, partialChecked = FALSE),
  "01.1.1" = list(checked = TRUE, partialChecked = FALSE)
)
jsonlite::write_json(
  example_selection,
  path = file.path(out_dir, "example_treeselect_value.json"),
  pretty = TRUE,
  auto_unbox = TRUE
)

#---- Preview -----------------------------------------------------------------

cat("Sheet used: ", sheet_name, "\n", sep = "")
cat("Header row: ", header_row, "\n", sep = "")
cat("Selected CPIH series: ", nrow(series_meta), "\n", sep = "")
cat("Top-level nodes: ", length(tree_nodes), "\n\n", sep = "")

cat("Sample metadata:\n")
print(head(series_meta, 12), n = 12)

cat("\nExample TreeNode JSON:\n")
cat(substr(jsonlite::toJSON(tree_nodes[1], auto_unbox = TRUE, pretty = TRUE), 1, 1500))
cat("\n")
