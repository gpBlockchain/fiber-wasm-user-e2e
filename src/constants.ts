export const DEFAULT_TESTNET_CONFIG = `# Fiber WASM testnet demo config.
fiber:
  listening_addr: "/ip4/127.0.0.1/tcp/8228/ws"
  bootnode_addrs:
    - "/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: false
  announced_addrs: []
  chain: testnet
  scripts:
    - name: FundingLock
      script:
        code_hash: 0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6
        - cell_dep:
            out_point:
              tx_hash: 0x5a5288769cecde6451cb5d301416c297a6da43dc3ac2f3253542b4082478b19b
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b
        - cell_dep:
            out_point:
              tx_hash: 0x5a5288769cecde6451cb5d301416c297a6da43dc3ac2f3253542b4082478b19b
              index: 0x0
            dep_type: code

rpc:
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://testnet.ckbapp.dev/"
  udt_whitelist:
    - name: RUSD
      script:
        code_hash: 0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a
        hash_type: type
        args: 0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f
      auto_accept_amount: 1000000000

services:
  - fiber
  - rpc
  - ckb
`;

export const DEFAULT_FORM_VALUES = {
  databasePrefix: `testnet-demo-${new Date().toISOString().slice(0, 10)}`,
  fundingAmount: "100000000000",
  paymentAmount: "1000",
  pollIntervalMs: 1000,
  connectPeerTimeoutMs: 5 * 60 * 1000,
  channelReadyTimeoutMs: 15 * 60 * 1000,
  graphSyncTimeoutMs: 15 * 60 * 1000,
  paymentTimeoutMs: 10 * 60 * 1000,
  restartRecoveryTimeoutMs: 5 * 60 * 1000,
  localNodeCount: 2
};

export const MAX_RPC_LOGS = 200;
export const MAX_FLOW_LOGS = 200;
export const MAX_EXPORT_ARRAY_ITEMS = 20;
export const MAX_EXPORT_DEPTH = 4;
export const MAX_EXPORT_STRING_LENGTH = 2000;

export const TESTNET_FLOW_STEP_DEFINITIONS = [
  ["start", "Start WASM Fiber"],
  ["node-info", "node_info"],
  ["graph-channels", "graph_channels"],
  ["connect-peer", "connect_peer"],
  ["open-channel", "open_channel"],
  ["channel-ready", "Wait ChannelReady"],
  ["graph-sync", "Wait graph sync"],
  ["send-payment", "send_payment"],
  ["stop", "Stop Fiber"],
  ["restart", "Restart Fiber"],
  ["restart-recovery", "Recover peers/channels"],
  ["restart-payment", "Send payment after restart"],
  ["shutdown", "shutdown_channel"]
] as const;

export const LOCAL_MULTI_NODE_STEP_DEFINITIONS = [
  ["local-start-nodes", "Start local WASM nodes"],
  ["local-node-info", "Collect local node_info"],
  ["local-connect-peers", "Connect external peers"],
  ["local-open-channels", "Open channels to external peers"],
  ["local-channel-ready", "Wait local channels ready"],
  ["local-graph-sync", "Wait cross-node graph sync"],
  ["local-send-payments", "Send payments between local nodes"],
  ["local-shutdown", "Shutdown local nodes"]
] as const;

export const FLOW_STEP_DEFINITIONS = [
  ...TESTNET_FLOW_STEP_DEFINITIONS,
  ...LOCAL_MULTI_NODE_STEP_DEFINITIONS
] as const;

export function getFlowStepDefinitions(scenario: "testnet-single" | "local-multi-node") {
  return scenario === "local-multi-node"
    ? LOCAL_MULTI_NODE_STEP_DEFINITIONS
    : TESTNET_FLOW_STEP_DEFINITIONS;
}
