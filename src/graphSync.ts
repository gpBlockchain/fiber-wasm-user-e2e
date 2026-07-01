export interface GraphSyncSample {
  elapsedSeconds: number;
  graphChannelsCount: number;
  graphNodesCount: number;
  listPeersCount: number;
}

export type GraphSyncSeriesKey = "graph_channels" | "graph_nodes" | "list_peers";

export interface GraphSyncSummary {
  label: string;
  durationSeconds: number;
  sampleIntervalSeconds: number;
  initialGraphChannelsCount: number;
  finalGraphChannelsCount: number;
  graphChannelsDelta: number;
  graphChannelsRatePerMinute: number;
  initialGraphNodesCount: number;
  finalGraphNodesCount: number;
  graphNodesDelta: number;
  graphNodesRatePerMinute: number;
  initialListPeersCount: number;
  finalListPeersCount: number;
  listPeersDelta: number;
  listPeersRatePerMinute: number;
  samples: GraphSyncSample[];
}

export interface GraphSyncChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GraphSyncChartOptions {
  width?: number;
  height?: number;
  padding?: GraphSyncChartPadding;
  visibleSeries?: GraphSyncSeriesKey[];
}

export interface GraphSyncChartModel {
  width: number;
  height: number;
  maxValue: number;
  maxElapsedSeconds: number;
  channelPolyline: string;
  nodePolyline: string;
  peerPolyline: string;
  latestChannelCount: number;
  latestNodeCount: number;
  latestListPeersCount: number;
}

export function summarizeGraphSyncSamples(
  samples: GraphSyncSample[],
  durationSeconds: number,
  sampleIntervalSeconds: number,
  label: string
): GraphSyncSummary {
  if (samples.length === 0) {
    throw new Error("At least one graph sync sample is required.");
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedSeconds = Math.max(last.elapsedSeconds, durationSeconds);
  const graphChannelsDelta = last.graphChannelsCount - first.graphChannelsCount;
  const graphNodesDelta = last.graphNodesCount - first.graphNodesCount;
  const listPeersDelta = last.listPeersCount - first.listPeersCount;

  return {
    label,
    durationSeconds,
    sampleIntervalSeconds,
    initialGraphChannelsCount: first.graphChannelsCount,
    finalGraphChannelsCount: last.graphChannelsCount,
    graphChannelsDelta,
    graphChannelsRatePerMinute: ratePerMinute(graphChannelsDelta, elapsedSeconds),
    initialGraphNodesCount: first.graphNodesCount,
    finalGraphNodesCount: last.graphNodesCount,
    graphNodesDelta,
    graphNodesRatePerMinute: ratePerMinute(graphNodesDelta, elapsedSeconds),
    initialListPeersCount: first.listPeersCount,
    finalListPeersCount: last.listPeersCount,
    listPeersDelta,
    listPeersRatePerMinute: ratePerMinute(listPeersDelta, elapsedSeconds),
    samples
  };
}

export function createGraphSyncChartModel(
  samples: GraphSyncSample[],
  options: GraphSyncChartOptions = {}
): GraphSyncChartModel | undefined {
  if (samples.length === 0) {
    return undefined;
  }

  const width = options.width ?? 520;
  const height = options.height ?? 220;
  const padding = options.padding ?? { top: 18, right: 18, bottom: 30, left: 46 };
  const visibleSeries = new Set(options.visibleSeries ?? ["graph_channels", "graph_nodes", "list_peers"]);
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  const visibleValues = samples.flatMap((sample) => [
    ...(visibleSeries.has("graph_channels") ? [sample.graphChannelsCount] : []),
    ...(visibleSeries.has("graph_nodes") ? [sample.graphNodesCount] : []),
    ...(visibleSeries.has("list_peers") ? [sample.listPeersCount] : [])
  ]);
  const maxValue = Math.max(
    1,
    ...visibleValues
  );
  const maxElapsedSeconds = Math.max(1, ...samples.map((sample) => sample.elapsedSeconds));
  const xFor = (sample: GraphSyncSample, index: number) =>
    roundCoordinate(
      padding.left +
        (samples.length === 1
          ? chartWidth / 2
          : (Math.max(0, sample.elapsedSeconds) / maxElapsedSeconds) * chartWidth)
    );
  const yFor = (value: number) =>
    roundCoordinate(padding.top + chartHeight - (Math.max(0, value) / maxValue) * chartHeight);
  const channelPolyline = visibleSeries.has("graph_channels")
    ? samples
        .map((sample, index) => `${xFor(sample, index)},${yFor(sample.graphChannelsCount)}`)
        .join(" ")
    : "";
  const nodePolyline = visibleSeries.has("graph_nodes")
    ? samples
        .map((sample, index) => `${xFor(sample, index)},${yFor(sample.graphNodesCount)}`)
        .join(" ")
    : "";
  const peerPolyline = visibleSeries.has("list_peers")
    ? samples
        .map((sample, index) => `${xFor(sample, index)},${yFor(sample.listPeersCount)}`)
        .join(" ")
    : "";
  const latest = samples[samples.length - 1];

  return {
    width,
    height,
    maxValue,
    maxElapsedSeconds,
    channelPolyline,
    nodePolyline,
    peerPolyline,
    latestChannelCount: latest.graphChannelsCount,
    latestNodeCount: latest.graphNodesCount,
    latestListPeersCount: latest.listPeersCount
  };
}

function ratePerMinute(delta: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) {
    return 0;
  }

  return Number((delta * 60 / elapsedSeconds).toFixed(3));
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(1));
}
