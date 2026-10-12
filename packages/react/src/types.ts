import type {CSSProperties, ReactNode} from 'react';
import type {AxisFormat, FigureEventMap, HoverEvent, ThemeInput} from '@vesora/core';

export type ChartType = 'line' | 'bar' | 'scatter';

export interface ChartSeries<Row extends object> {
  /** A stable data-column key also identifies this series between updates. */
  key: Extract<keyof Row, string>;
  label?: string;
  color?: string;
  visible?: boolean;
  width?: number;
  size?: number;
  opacity?: number;
}

export interface ChartAxis {
  type?: 'linear' | 'log' | 'time';
  label?: string;
  domain?: [number, number];
  format?: 'number' | 'currency' | 'percent' | 'date' | AxisFormat;
  currency?: string;
  locale?: string;
  timeZone?: string;
  options?: Intl.NumberFormatOptions | Intl.DateTimeFormatOptions;
}

export interface ChartInteraction<Row extends object> {
  event: HoverEvent;
  row?: Row;
  series?: ChartSeries<Row>;
  formattedX: string;
  formattedY: string;
}

export interface VesoraChartHandle {
  exportPNG(): Promise<Blob>;
  /** The HTML includes every chart source row. React callbacks are not included. */
  exportHTML(): Promise<string>;
  resetView(): void;
}

export interface VesoraChartProps<Row extends object> {
  type: ChartType;
  data: readonly Row[];
  xKey: Extract<keyof Row, string>;
  series: readonly ChartSeries<Row>[];
  title?: string;
  height?: number;
  theme?: ThemeInput;
  xAxis?: ChartAxis;
  yAxis?: ChartAxis;
  barMode?: 'group' | 'stack';
  /** Position-axis units; time-position bars use milliseconds. */
  barWidth?: number;
  orientation?: 'vertical' | 'horizontal';
  loading?: boolean;
  error?: string | Error | null;
  legend?: boolean;
  tooltip?: boolean;
  renderTooltip?: (interaction: ChartInteraction<Row>) => ReactNode;
  renderLoading?: () => ReactNode;
  renderEmpty?: () => ReactNode;
  renderError?: (message: string, retry: () => void) => ReactNode;
  onHover?: (interaction: ChartInteraction<Row> | null) => void;
  onClick?: (interaction: ChartInteraction<Row>) => void;
  /** Selection indices are the core's bounded preview, not a complete cohort. */
  onSelection?: (event: FigureEventMap['selection']) => void;
  onError?: (event: FigureEventMap['error']) => void;
  onSeriesVisibilityChange?: (key: Extract<keyof Row, string>, visible: boolean) => void;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}
