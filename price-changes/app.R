library(shiny)
library(readr)
library(dplyr)
library(tidyr)
library(stringr)
library(lubridate)
library(ggplot2)
library(ggnewscale)
library(ggiraph)

# ---- Load consumer price index timeseries ----
# Data regularly updated using `price-changes/update-cpi.R`
cpi_components <- read_csv("data/cpi_components.csv")

# ---- UI ----
ui <- fluidPage(
  titlePanel("Explore price changes in the UK"),

  fluidRow(
    column(
      12,

      p("Track how prices have changed for consumer goods and services in the UK. Choose a year from which to measure the percentage change, based on the consumer price index (CPI) published by the", a("Office for National Statistics", hred = "https://www.ons.gov.uk/economy/inflationandpriceindices", target = "_blank")),

      sliderInput(
        "from_year",
        label = str_glue("Pick a year between {min(cpi_components$Year)} and {max(cpi_components$Year)}"),
        min = min(cpi_components$Year),
        max = max(cpi_components$Year),
        step = 1,
        sep = "",
        value = 2008,
        width = "50%"
      )
    )
  ),

  fluidRow(
    column(
      12,

      selectizeInput(
        "components_filter",
        label = "Choose consumer goods and services to see in the graph",
        choices = sort(unique(cpi_components$`CPI component`)),
        selected = c(
          "Food", "Clothing", "Actual rents for housing", "Financial services n.e.c.",
          "Electricity, gas and other fuels", "Insurance", "Personal care",
          "Transport services", "Water supply and misc. services for the dwelling"
        ),
        multiple = TRUE,
        width = "90%"
      )
    )
  ),

  fluidRow(
    column(
      12,

     girafeOutput("inflationPlot", width = "70%")
    )
  )
)

# ---- Server ----
server <- function(input, output) {
  output$inflationPlot <- renderGirafe({
    # Calculate percentage change for each component since `from_year`
    cpi_components_change <-
      cpi_components |>
      filter(Year >= input$from_year) |>
      #filter(Year == 2024) |>

      group_by(`CPI component`) |>
      mutate(pct_change = (pct_change - first(pct_change)) / first(pct_change)) |>
      ungroup()

    # Fetch headline inflation rate
    headline_inflation <-
      cpi_components_change |>
      filter(Date == max(Date) & `CPI component` == "Cpi index 00: all items") |>
      pull(pct_change)

    cpi_components_change <-
      cpi_components_change |>

      # filter(`CPI component` != "Cpi index 00: all items") |>
      filter(`CPI component` %in% input$components_filter) |>

      # Fetch the most recent % change value for each CPI component: this will be used to colour the lines in the plot along a red or blue gradient
      group_by(`CPI component`) |>
      mutate(latest_value = last(pct_change)) |>
      ungroup()

    from_year_text <- format(min(cpi_components_change$Date), "%B %Y")
    to_year_text <- format(max(cpi_components_change$Date), "%B %Y")

    # Which CPI components inflated or deflated since `from_year`
    # Inflated components will be coloured red; deflated will be blue
    inflated_components <-
      cpi_components_change |>
      filter(Date == max(Date) & pct_change > 0) |>
      pull(`CPI component`)

    deflated_components <-
      cpi_components_change |>
      filter(Date == max(Date) & pct_change <= 0) |>
      pull(`CPI component`)

    plt <-
      cpi_components_change |>
      filter(`CPI component` %in% inflated_components) |>

      ggplot(aes(x = Date, y = pct_change, group = `CPI component`, data_id = `CPI component`)) +

      geom_hline(yintercept = 0) +
      geom_hline_interactive(
        yintercept = headline_inflation,
        tooltip = str_glue("Overall inflation: {scales::percent(headline_inflation, accuracy = 0.1)}"),
        linetype = 2
      ) +

      geom_line_interactive(
        aes(
          colour = latest_value,
          tooltip = `CPI component`
        )
      ) +
      geom_point_interactive(
        aes(
          colour = latest_value,
          tooltip = str_glue("By {format(Date, '%d %B %Y')}, the price of {tolower(`CPI component`)} increased by {scales::percent(pct_change, accuracy = 0.1)}")
        ),
        size = 0.8
      ) +
      scale_colour_gradient_interactive(low = "#ffe6e6", high = "#4d0000") +

      new_scale_colour() +

      geom_line_interactive(
        data = cpi_components_change |> filter(`CPI component` %in% deflated_components),
        aes(
          colour = latest_value,
          tooltip = `CPI component`
        )
      ) +
      geom_point_interactive(
        data = cpi_components_change |> filter(`CPI component` %in% deflated_components),
        aes(
          colour = latest_value,
          tooltip = str_glue("By {format(Date, '%d %B %Y')}, the price of {tolower(`CPI component`)} fell by {scales::percent(pct_change, accuracy = 0.1)}")
        ),
        size = 0.8
      ) +
      scale_colour_gradient_interactive(low = "#cce0ff", high = "#001f4d") +

      scale_y_continuous(labels = scales::percent) +
      theme_classic() +
      theme(
        plot.title.position = "plot",
        legend.position = "none"
      ) +
      labs(
        title = str_glue("Price changes in the UK from {from_year_text} to {to_year_text}"),
        x = NULL,
        y = NULL
      )

    girafe(
      ggobj = plt,
      options = list(
        opts_hover_inv(css = "opacity:0.1;"),
        opts_hover(css = "stroke-width:2;"),

        # opts_selection(type = "multiple", css = "fill:#FF851B;stroke:black;"),
        opts_toolbar(saveaspng = FALSE, position = "topright", delay_mouseout = 10000),
        opts_tooltip(
          css = "background-color:black;color:white;padding:10px;border-radius:10px;box-shadow:10px 10px 10px rgba(0,0,0,0.3);font-family:Arial;font-size:12px;",
          opacity = 0.9,
          use_fill = TRUE
        ),
        opts_sizing(rescale = FALSE),
        opts_zoom(max = 2)
      )
    )
  })

}

# ---- Run the application ----
shinyApp(ui = ui, server = server)
