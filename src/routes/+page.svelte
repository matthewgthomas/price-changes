<script lang="ts">
  import { onMount } from 'svelte';
  import { csvParse } from 'd3-dsv';
  import { extent, max, min } from 'd3-array';
  import { scaleLinear, scaleTime } from 'd3-scale';
  import { line as shapeLine, curveMonotoneX } from 'd3-shape';
  import { format as numberFormat } from 'd3-format';
  import { timeFormat } from 'd3-time-format';

  type RawRow = {
    year: number;
    date: Date;
    component: string;
    value: number;
  };

  type ChartPoint = RawRow & { change: number };

  type Series = {
    name: string;
    points: ChartPoint[];
    latest: number;
    color: string;
  };

  const formatter = numberFormat('.1%');
  const dateFormatter = timeFormat('%d %B %Y');
  const monthFormatter = timeFormat('%B %Y');

  const defaultSelections = [
    'Food',
    'Clothing',
    'Actual rents for housing',
    'Financial services n.e.c.',
    'Electricity, gas and other fuels',
    'Insurance',
    'Personal care',
    'Transport services',
    'Water supply and misc. services for the dwelling'
  ];

  const margin = { top: 24, right: 20, bottom: 40, left: 60 };
  const viewWidth = 980;
  const viewHeight = 560;

  let rawData: RawRow[] = [];
  let availableComponents: string[] = [];
  let selectedList: string[] = [];
  let selectedYear = 2008;
  let selectedMonth = '01';
  let requestedDate = new Date(2008, 0, 1);
  let effectiveFromDate = requestedDate;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  let minYear = 1988;
  let maxYear = 1988;
  let yearOptions: number[] = [];
  let loading = true;
  let error = '';

  let hover:
    | {
        component: string;
        date: Date;
        change: number;
        color: string;
        x: number;
        y: number;
      }
    | null = null;

  const clampDate = (date: Date, min: Date, max: Date) =>
    new Date(Math.min(Math.max(date.getTime(), min.getTime()), max.getTime()));

  const buildMonthDate = (year: number, month: string) => {
    const m = Number(month) || 1;
    return new Date(year || 1988, Math.min(Math.max(m, 1), 12) - 1, 1);
  };

  const monthOptions = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  onMount(async () => {
    try {
      const response = await fetch('/data/cpi_components.csv');
      const text = await response.text();
      const parsed = csvParse(text, (d) => {
        if (!d.Date || !d['CPI component'] || !d.pct_change) return null;

        return {
          year: Number(d.Year),
          date: new Date(String(d.Date)),
          component: String(d['CPI component']),
          value: Number(d.pct_change)
        } satisfies RawRow;
      }).filter(Boolean) as RawRow[];

      rawData = parsed.sort((a, b) => a.date.getTime() - b.date.getTime());
      const dates = rawData.map((d) => d.date);
      minDate = min(dates) ?? null;
      maxDate = max(dates) ?? null;

      if (minDate && maxDate) {
        minYear = minDate.getFullYear();
        maxYear = maxDate.getFullYear();
        yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

        const initial = new Date(2008, 0, 1);
        const clamped = clampDate(initial, minDate, maxDate);
        selectedYear = clamped.getFullYear();
        selectedMonth = String(clamped.getMonth() + 1).padStart(2, '0');
      }

      availableComponents = Array.from(new Set(rawData.map((d) => d.component))).sort((a, b) =>
        a.localeCompare(b)
      );

      const defaults = defaultSelections.filter((name) => availableComponents.includes(name));
      selectedList = defaults.length ? defaults : availableComponents.slice(0, 10);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to load CPI data.';
    } finally {
      loading = false;
    }
  });

  const mix = (start: string, end: string, t: number) => {
    const s = start.match(/\w\w/g)?.map((hex) => parseInt(hex, 16)) ?? [0, 0, 0];
    const e = end.match(/\w\w/g)?.map((hex) => parseInt(hex, 16)) ?? [0, 0, 0];
    const rgb = s.map((value, i) => Math.round(value + (e[i] - value) * t));
    return `rgb(${rgb.join(',')})`;
  };

  const gradientColor = (latest: number, posMax: number, negMin: number) => {
    if (latest >= 0) {
      const t = posMax > 0 ? Math.min(latest / posMax, 1) : 0.5;
      return mix('ffe6e6', '4d0000', t);
    }
    const t = negMin < 0 ? Math.min(Math.abs(latest) / Math.abs(negMin), 1) : 0.5;
    return mix('cce0ff', '001f4d', t);
  };

  const buildSeries = (rows: RawRow[]) => {
    const grouped = new Map<string, RawRow[]>();
    rows.forEach((row) => {
      if (!grouped.has(row.component)) grouped.set(row.component, []);
      grouped.get(row.component)?.push(row);
    });

    const tempSeries: Omit<Series, 'color'>[] = [];

    grouped.forEach((points, component) => {
      if (!points.length) return;
      const sorted = points.sort((a, b) => a.date.getTime() - b.date.getTime());
      const base = sorted[0]?.value ?? 0;
      const chartPoints: ChartPoint[] = sorted.map((point) => ({
        ...point,
        change: base !== 0 ? (point.value - base) / base : 0
      }));

      tempSeries.push({
        name: component,
        points: chartPoints,
        latest: chartPoints.at(-1)?.change ?? 0
      });
    });

    const positives = tempSeries.map((s) => s.latest).filter((v) => v >= 0);
    const negatives = tempSeries.map((s) => s.latest).filter((v) => v < 0);
    const posMax = positives.length ? Math.max(...positives) : 0;
    const negMin = negatives.length ? Math.min(...negatives) : 0;

    const series = new Map<string, Series>();
    tempSeries.forEach((item) => {
      series.set(item.name, {
        ...item,
        color: gradientColor(item.latest, posMax, negMin)
      });
    });

    return series;
  };

  $: requestedDate = buildMonthDate(selectedYear, selectedMonth);
  $: effectiveFromDate =
    minDate && maxDate ? clampDate(requestedDate, minDate, maxDate) : requestedDate;

  $: filtered = rawData.filter((row) => row.date >= effectiveFromDate);
  $: seriesMap = buildSeries(filtered);
  $: selectedSeries = selectedList
    .map((name) => seriesMap.get(name))
    .filter(Boolean) as Series[];
  $: headlineSeries = seriesMap.get('Cpi index 00: all items');
  $: dates = filtered.map((d) => d.date);
  $: xDomain = dates.length ? extent(dates) : [new Date(), new Date()];
  $: xDomainKey = xDomain.map((d) => d.getTime()).join('-');
  $: yValues = selectedSeries.flatMap((s) => s.points.map((p) => p.change));
  $: yDomain = yValues.length ? extent([...yValues, 0, headlineSeries?.latest ?? 0]) : [-0.1, 0.1];

  $: xScale = scaleTime(xDomain as [Date, Date], [margin.left, viewWidth - margin.right]);
  $: yScale = scaleLinear(yDomain as [number, number], [viewHeight - margin.bottom, margin.top]);

  const buildPath = (points: ChartPoint[], scaleX: typeof xScale, scaleY: typeof yScale) =>
    shapeLine<ChartPoint>()
      .x((d) => scaleX(d.date))
      .y((d) => scaleY(d.change))
      .curve(curveMonotoneX)(points) ?? '';

  $: xTicks = xScale.ticks(6);
  $: yTicks = yScale.ticks(6);

  $: minLabel = minDate ? monthFormatter(minDate) : '';
  $: maxLabel = maxDate ? monthFormatter(maxDate) : '';
  $: fromLabel = monthFormatter(effectiveFromDate);
  $: startPeriod = filtered.length ? dateFormatter(filtered[0].date) : '';
  $: endPeriod = filtered.length ? dateFormatter(filtered[filtered.length - 1].date) : '';
  $: showMonthYearTicks =
    !!(maxDate && effectiveFromDate >= new Date(maxDate.getFullYear() - 3, maxDate.getMonth(), maxDate.getDate()));

  const setSelection = (names: string[]) => {
    selectedList = names.filter((name) => availableComponents.includes(name));
  };

  const handleHover = (event: MouseEvent, point: ChartPoint, color: string) => {
    const target = event.currentTarget as SVGCircleElement;
    const { x, y } = target.getBoundingClientRect();
    const parent = (target.ownerSVGElement as SVGSVGElement)?.getBoundingClientRect();

    hover = {
      component: point.component,
      date: point.date,
      change: point.change,
      color,
      x: x - (parent?.left ?? 0),
      y: y - (parent?.top ?? 0)
    };
  };
</script>

<svelte:head>
  <title>Price changes in the UK</title>
  <meta name="description" content="Explore UK consumer price index movements since 1988 with interactive visuals." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <h1>Explore price changes in the UK</h1>
    <p>
      Track how prices have shifted for consumer goods and services using the consumer price index (CPI).
      Pick a starting month and year, choose the components you care about, and hover the chart to see detailed
      movements.
    </p>
    <p>
      Data source:
      <a href="https://www.ons.gov.uk/economy/inflationandpriceindices" target="_blank" rel="noreferrer"
        >Office for National Statistics</a
      >
    </p>
  </header>

  <section>
    <div class="controls">
      <div class="control-card">
        <div class="label-row">
          <label for="from-month">Starting month</label>
          <strong>{fromLabel}</strong>
        </div>
        <div class="picker-row">
          <select
            id="from-month"
            class="month-select"
            bind:value={selectedMonth}
            aria-label="Pick a month to compare price changes"
          >
            {#each monthOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          <input
            id="from-year"
            class="year-input"
            type="number"
            min={minYear}
            max={maxYear}
            list="year-options"
            bind:value={selectedYear}
            aria-label="Pick a year (1988 or later) to compare price changes"
          />
          <datalist id="year-options">
            {#each yearOptions as year}
              <option value={year}></option>
            {/each}
          </datalist>
        </div>
        <p>Choose any month between {minLabel} and {maxLabel}. You can type a year or pick from the list.</p>
      </div>

      <div class="control-card">
        <div class="label-row">
          <label for="component-picker">CPI components</label>
          <span>{selectedList.length} selected</span>
        </div>
        <select
          id="component-picker"
          class="multi-select"
          multiple
          size="10"
          bind:value={selectedList}
          aria-label="Select consumer price index components"
        >
          {#each availableComponents as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
        <div class="button-row">
          <button type="button" on:click={() => setSelection(availableComponents)}>Select all</button>
          <button type="button" class="secondary" on:click={() => setSelection(defaultSelections)}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  </section>

  {#if loading}
    <section><p>Loading CPI data…</p></section>
  {:else if error}
    <section><p role="alert">{error}</p></section>
  {:else}
    <section>
      <div class="summary-row">
        <div class="card">
          <h3>Data coverage</h3>
          <p>{startPeriod} to {endPeriod}</p>
        </div>
        <div class="card">
          <h3>Overall inflation</h3>
          <p>
            {headlineSeries ? formatter(headlineSeries.latest) : 'Not available'} since {fromLabel}
          </p>
        </div>
        <div class="card">
          <h3>Components shown</h3>
          <p>{selectedList.length} of {availableComponents.length}</p>
        </div>
      </div>

      <div class="chart-wrapper">
        <h2>Price changes from {fromLabel} through {endPeriod}</h2>
        {#if !selectedSeries.length}
          <p>Pick one or more CPI components to view the chart.</p>
        {:else}
          {#key xDomainKey}
            <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="Price change chart">
              <g class="axis">
                {#each xTicks as tick}
                  <g transform={`translate(${xScale(tick)}, ${viewHeight - margin.bottom})`}>
                    <line y2="8" stroke="#cbd5e1" />
                    <text y="24" text-anchor="middle">
                      {showMonthYearTicks ? timeFormat('%b %Y')(tick) : timeFormat('%Y')(tick)}
                    </text>
                  </g>
                {/each}
                <line
                  x1={margin.left}
                  x2={viewWidth - margin.right}
                  y1={viewHeight - margin.bottom}
                  y2={viewHeight - margin.bottom}
                  stroke="#cbd5e1"
                />

                {#each yTicks as tick}
                  <g transform={`translate(0, ${yScale(tick)})`}>
                    <line x1={margin.left - 6} x2={viewWidth - margin.right} stroke="#e2e8f0" />
                    <text x={margin.left - 10} text-anchor="end" alignment-baseline="middle">
                      {formatter(tick)}
                    </text>
                  </g>
                {/each}
              </g>

              <line
                x1={margin.left}
                x2={viewWidth - margin.right}
                y1={yScale(0)}
                y2={yScale(0)}
                stroke="#94a3b8"
                stroke-dasharray="4 6"
                stroke-width="1.2"
              />

              {#if headlineSeries}
                <line
                  x1={margin.left}
                  x2={viewWidth - margin.right}
                  y1={yScale(headlineSeries.latest)}
                  y2={yScale(headlineSeries.latest)}
                  stroke="#0f172a"
                  stroke-dasharray="6 6"
                  stroke-width="1.4"
                />
                <text
                  x={viewWidth - margin.right}
                  y={yScale(headlineSeries.latest) - 8}
                  text-anchor="end"
                  fill="#0f172a"
                  font-weight="600"
                >
                  Overall inflation {formatter(headlineSeries.latest)}
                </text>
              {/if}

              {#each selectedSeries as series (series.name)}
                <path
                  d={buildPath(series.points, xScale, yScale)}
                  fill="none"
                  stroke={series.color}
                  stroke-width="2"
                  stroke-linecap="round"
                  opacity="0.92"
                />

                {#each series.points as point (point.date.toISOString() + series.name)}
                  <circle
                    cx={xScale(point.date)}
                    cy={yScale(point.change)}
                    r={3.3}
                    fill={series.color}
                    on:mouseenter={(event) => handleHover(event, point, series.color)}
                    on:mouseleave={() => (hover = null)}
                  />
                {/each}
              {/each}
            </svg>
          {/key}

          {#if hover}
            <div class="tooltip" style={`left:${hover.x}px; top:${hover.y}px;`}>
              <strong>{hover.component}</strong><br />
              {dateFormatter(hover.date)}<br />
              {hover.change >= 0 ? 'Prices increased by ' : 'Prices fell by '}{formatter(Math.abs(hover.change))}
              since {fromLabel}
            </div>
          {/if}
        {/if}

        {#if selectedSeries.length}
          <div class="legend">
            {#each selectedSeries as series (series.name)}
              <div class="legend-item">
                <span class="legend-swatch" style={`background:${series.color}`}></span>
                <div>
                  <div>{series.name}</div>
                  <small>{series.latest >= 0 ? 'Up' : 'Down'} {formatter(Math.abs(series.latest))}</small>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>
