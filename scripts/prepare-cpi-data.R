# Prepare UK CPIH data for the price-changes website
# ---------------------------------------------------
# 1) Downloads the current MM23 dataset (CSV) from ONS
# 2) Keeps every monthly "CPIH ... 2015=100" INDEX series:
#    - All items (00), divisions (xx), groups (xx.x), classes (xx.x.x),
#      subclasses (xx.x.x.x) — including combined codes like 01.1.1.7/8
#      and lettered splits like 07.1.1A
#    - Special aggregates: Goods/Services breakdowns and core
#      ("excluding ...") measures
# 3) Cleans series names and derives the COICOP hierarchy
# 4) Writes a single compact JSON file consumed by the static site
#
# CPIH is the Consumer Prices Index including owner occupiers' housing
# costs — the ONS's lead measure of consumer price inflation.
#
# Source: https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindices

packages <- c("readr", "dplyr", "tidyr", "purrr", "stringr", "lubridate", "jsonlite")
missing_pkgs <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_pkgs) > 0) {
  install.packages(missing_pkgs, repos = "https://cloud.r-project.org")
}

library(readr)
library(dplyr)
library(tidyr)
library(purrr)
library(stringr)
library(lubridate)
library(jsonlite)

mm23_url <- "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/consumerpriceindices/current/mm23.csv"
out_path <- "site/data/cpi.json"

# ---- Download and read ------------------------------------------------------

Sys.setenv("VROOM_CONNECTION_SIZE" = 5000000)
mm23_raw <- read_csv(
  mm23_url,
  col_types = cols(.default = col_character()),
  name_repair = "minimal"
)
Sys.unsetenv("VROOM_CONNECTION_SIZE")

mm23_raw <- rename(mm23_raw, Date = 1)

# Drop duplicated column names (keep first occurrence)
mm23_raw <- mm23_raw[, !duplicated(names(mm23_raw))]

# ---- Identify CPIH index columns --------------------------------------------
# MM23 column naming is inconsistent: monthly/annual *rate* series for the
# special aggregates are also suffixed "2015=100" (e.g. "CPIH 12mth: Energy
# (G) 2015=100"), and one or two genuine index columns omit the word INDEX
# (e.g. "CPIH 09.2.1/2/3 : Major durables ..."). Select on name, then verify
# numerically below that each candidate really is an index series.

candidate_cols <- names(mm23_raw)[
  str_detect(names(mm23_raw), "^CPIH (INDEX|\\d)") &
    str_detect(names(mm23_raw), "2015\\s*=\\s*100") &
    !str_detect(names(mm23_raw),
                regex("RATE|12\\s?mth|1\\s?mth|contribution|% points|weights",
                      ignore_case = TRUE))
]
stopifnot(length(candidate_cols) > 300)

# ---- Monthly observations from Jan 1988 -------------------------------------

year_month_regex <- paste0("^[0-9]{4} (", paste(toupper(month.abb), collapse = "|"), ")$")

cpi_monthly <- mm23_raw |>
  filter(str_detect(Date, year_month_regex)) |>
  mutate(Date = ym(Date)) |>
  filter(Date >= ym("1988-01")) |>
  arrange(Date) |>
  select(Date, all_of(candidate_cols)) |>
  mutate(across(-Date, as.numeric))

# Numeric sanity check: index series hover around 100; anything that is
# actually a percentage-change series in disguise gets dropped here
is_index_like <- vapply(candidate_cols, function(col) {
  med <- median(cpi_monthly[[col]], na.rm = TRUE)
  !is.na(med) && med > 20
}, logical(1))
index_cols <- candidate_cols[is_index_like]

dropped <- candidate_cols[!is_index_like]
if (length(dropped) > 0) {
  message("Dropped non-index candidates: ", paste(dropped, collapse = " | "))
}

dates <- format(cpi_monthly$Date, "%Y-%m")

# ---- Metadata rows (CDID, release dates) ------------------------------------

meta_rows <- mm23_raw |> filter(Date %in% c("CDID", "Release date", "Next release"))
get_meta <- function(row_name, col) {
  val <- meta_rows |> filter(Date == row_name) |> pull(all_of(col))
  if (length(val) == 0) NA_character_ else val[[1]]
}
first_meta <- function(row_name) {
  row <- meta_rows |> filter(Date == row_name)
  if (nrow(row) == 0) return(NA_character_)
  vals <- as.character(row[1, -1])
  vals <- vals[!is.na(vals) & vals != ""]
  if (length(vals) == 0) NA_character_ else vals[[1]]
}
cdids <- vapply(index_cols, function(col) get_meta("CDID", col), character(1))
release_date <- first_meta("Release date")
next_release <- first_meta("Next release")

# ---- Name cleaning ----------------------------------------------------------

clean_desc <- function(x) {
  x |>
    str_replace_all("&", " and ") |>
    str_replace_all(regex("\\bFURN\\b", ignore_case = TRUE), "furnishings") |>
    str_replace_all(regex("\\bHH\\b", ignore_case = TRUE), "household") |>
    str_replace_all(regex("\\bEQUIP\\b", ignore_case = TRUE), "equipment") |>
    str_replace_all(regex("\\bmisc\\.?\\b", ignore_case = TRUE), "miscellaneous") |>
    str_replace_all(regex("\\belec\\.?\\b", ignore_case = TRUE), "electricity") |>
    str_replace_all(regex("\\bexcl\\.?\\b", ignore_case = TRUE), "excluding") |>
    str_replace_all(regex("\\bincl\\.?\\b", ignore_case = TRUE), "including") |>
    str_replace_all(regex("\\bpreps\\b", ignore_case = TRUE), "preparations") |>
    str_replace_all(regex("\\bOOH\\b", ignore_case = TRUE), "owner occupiers' housing") |>
    str_replace_all(regex("\\bn\\.?e\\.?c\\.?\\b", ignore_case = TRUE), "NEC") |>
    str_replace_all("NON - ", "non-") |>
    str_replace_all(",(?=\\S)", ", ") |>
    str_squish() |>
    (\(s) {
      # Sentence case: lower everything, capitalise first letter
      s <- str_to_lower(s)
      str_c(str_to_upper(str_sub(s, 1, 1)), str_sub(s, 2))
    })() |>
    str_replace_all(regex("\\bnec\\b", ignore_case = TRUE), "NEC") |>
    str_replace_all(regex("\\buk\\b", ignore_case = TRUE), "UK") |>
    str_replace_all(regex("\\bdvd\\b", ignore_case = TRUE), "DVD") |>
    str_replace_all(regex("\\bcd\\b", ignore_case = TRUE), "CD") |>
    str_replace_all(regex("\\btv\\b", ignore_case = TRUE), "TV") |>
    str_squish()
}

slugify <- function(x) {
  x |>
    str_to_lower() |>
    str_replace_all("[^a-z0-9]+", "-") |>
    str_replace_all("^-|-$", "")
}

# Strip the last segment of a COICOP-ish code, treating combined codes as one
# segment: "01.1.1.7/8" -> "01.1.1", "10.1/2/5" -> "10", "07.2" -> "07"
strip_last_segment <- function(code) {
  str_remove(code, "\\.[0-9/]+$")
}

# ---- Parse each column into series metadata ---------------------------------

parse_cpih_column <- function(col) {
  stripped <- col |>
    str_remove("\\s*2015\\s*=\\s*100\\s*$") |>
    str_remove("^CPIH\\s+INDEX\\s*") |>
    str_remove("^CPIH\\s*") |>
    str_squish()

  # Codes are COICOP-style ("07", "07.1", "01.1.1.7/8" for combined items);
  # a few carry a letter suffix ("07.1.1A New cars" / "07.1.1B Second-hand cars")
  code_match <- str_match(stripped, "^(\\d{2}(?:[./]\\d{1,2})*[A-Z]?)\\s*:?\\s*(.*)$")

  if (!is.na(code_match[1, 1])) {
    code <- code_match[1, 2]
    desc <- code_match[1, 3]
    name <- if (code == "00") "All items (overall CPIH)" else clean_desc(desc)
    depth <- str_count(code, fixed(".")) + 1L
    level <- c("division", "group", "class", "subclass")[depth]
    if (code == "00") level <- "all"
    parent <- if (code == "00") {
      NA_character_
    } else if (depth == 1L) {
      "00"
    } else if (str_detect(code, "[A-Z]$")) {
      # Letter-suffixed codes point at their unsuffixed stem; if that stem has
      # no series of its own, fix_parent() below walks up to a real ancestor
      str_remove(code, "[A-Z]$")
    } else {
      strip_last_segment(code)
    }
    tibble(column = col, id = code, code = code, name = name,
           level = level, parent = parent)
  } else {
    # Special aggregates, e.g. ": Goods", ": Energy (G)", ": Excl council tax"
    desc <- str_remove(stripped, "^:\\s*")
    suffix <- str_match(desc, "\\((G|S|SP)\\)\\s*$")[1, 2]
    desc <- str_squish(str_remove(desc, "\\((G|S|SP)\\)\\s*$"))
    name <- clean_desc(desc)

    parent <- case_when(
      name %in% c("Goods", "Services") ~ "x",
      !is.na(suffix) && suffix == "G" ~ "x:goods",
      !is.na(suffix) && suffix == "S" ~ "x:services",
      str_detect(name, regex("rentals for housing", ignore_case = TRUE)) ~ "x:rentals",
      TRUE ~ "x:core"
    )
    id <- if (name %in% c("Goods", "Services")) {
      paste0("x:", slugify(name))
    } else {
      paste0(parent, ":", slugify(name))
    }
    tibble(column = col, id = id, code = NA_character_, name = name,
           level = "aggregate", parent = parent)
  }
}

series_meta <- map_dfr(index_cols, parse_cpih_column) |>
  mutate(cdid = unname(cdids[column]))

stopifnot(!any(duplicated(series_meta$id)))

# If a parent code has no series of its own (gaps in ONS coverage),
# re-attach to the nearest ancestor that does exist
known_ids <- series_meta$id
fix_parent <- function(parent) {
  while (!is.na(parent) && str_detect(parent, "^\\d") && !(parent %in% known_ids)) {
    parent <- if (str_detect(parent, fixed("."))) {
      strip_last_segment(parent)
    } else {
      "00"
    }
  }
  parent
}
series_meta <- series_meta |> mutate(parent = map_chr(parent, fix_parent))

# ---- Folder nodes for the special aggregates branch -------------------------
# Only emit folders that actually have children

all_folders <- list(
  list(id = "x", name = "Goods, services & special indices", parent = NA),
  list(id = "x:core", name = "Core inflation & other measures", parent = "x"),
  list(id = "x:rentals", name = "Housing rentals", parent = "x")
)
used_parents <- unique(series_meta$parent)
folders <- keep(all_folders, function(f) {
  f$id == "x" || f$id %in% used_parents
})

# ---- Assemble JSON ----------------------------------------------------------

series_list <- map(seq_len(nrow(series_meta)), function(i) {
  row <- series_meta[i, ]
  vals <- round(cpi_monthly[[row$column]], 2)
  out <- list(
    id = row$id,
    name = row$name,
    level = row$level,
    parent = row$parent,
    cdid = row$cdid,
    values = vals
  )
  # Drop NA scalars entirely rather than serialising them as null/{}
  out[!vapply(out, function(x) length(x) == 1 && is.na(x), logical(1))]
})

payload <- list(
  meta = list(
    measure = "CPIH",
    updated = format(Sys.Date(), "%Y-%m-%d"),
    release_date = release_date,
    next_release = next_release,
    latest_month = tail(dates, 1),
    source = "Office for National Statistics, Consumer price inflation tables (MM23)",
    source_url = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindices"
  ),
  dates = dates,
  folders = folders,
  series = series_list
)

dir.create(dirname(out_path), showWarnings = FALSE, recursive = TRUE)
write_json(payload, out_path, auto_unbox = TRUE, na = "null", digits = NA)

# ---- Report -----------------------------------------------------------------

cat("Series written:", nrow(series_meta), "\n")
cat("Months:", length(dates), "(", dates[1], "to", tail(dates, 1), ")\n")
cat("Levels:\n")
print(count(series_meta, level))
cat("Output:", out_path, "(", round(file.size(out_path) / 1e6, 2), "MB )\n")
