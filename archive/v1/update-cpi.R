library(readr)
library(dplyr)
library(tidyr)
library(stringr)
library(lubridate)

# ---- Wrangle and save consumer price index timeseries ----
# Source: https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindices
Sys.setenv("VROOM_CONNECTION_SIZE" = 300000)
cpi_raw <- read_csv("https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/consumerpriceindices/current/mm23.csv")
Sys.unsetenv("VROOM_CONNECTION_SIZE")

cpi_raw <-
  cpi_raw |>
  slice(-(1:6)) |>
  rename(Date = Title)

# Fetch CPI index components and subcomponents names
component_names <- sort(grep(pattern = "CPI INDEX \\d{2}\\.\\d{1,2} ", names(cpi_raw), value = TRUE))

cpi_components <-
  cpi_raw |>
  select(Date, `CPI INDEX 00: ALL ITEMS 2015=100`, all_of(component_names)) |>

  # Keep quarterly data from Q1 1988 onwards
  filter(str_detect(Date, "[0-9]{4} Q\\d{1}")) |>
  mutate(Date = yq(Date)) |>
  filter(Date >= yq("1988 Q1")) |>

  mutate(across(where(is.character), as.numeric)) |>

  mutate(Year = year(Date)) |>
  relocate(Year)

cpi_components <-
  cpi_components |>
  pivot_longer(
    cols = -(Year:Date),
    names_to = "CPI component",
    values_to = "pct_change"
  ) |>

  mutate(`CPI component` = str_remove(`CPI component`, "CPI INDEX [0-9]{2}\\.[0-9]{1} : ")) |>
  mutate(`CPI component` = str_remove(`CPI component`, " 2015=100")) |>
  mutate(`CPI component` = str_to_sentence(`CPI component`))

# ---- Save to CSV in the repo ----
# adjust path if you like (e.g. "data/cpi_components.csv")
dir.create("price-changes/data", showWarnings = FALSE)
write_csv(cpi_components, "price-changes/data/cpi_components.csv")
