import type { FlowScenario, StepId } from "./types";

export type StepLesson = {
  concept: string;
  rpc: string;
  meaning: string;
  observe: string;
};

export const SCENARIO_LESSONS: Record<
  FlowScenario,
  {
    title: string;
    goal: string;
    outcome: string;
  }
> = {
  "testnet-single": {
    title: "Testnet single node learning path",
    goal: "Follow one browser Fiber node from startup to channel open, graph visibility, payment, restart recovery, and graceful shutdown.",
    outcome:
      "You should understand which RPC proves each stage and where failures usually point: keys, peer connectivity, on-chain funding, graph gossip, payment routing, or persistence."
  },
  "local-multi-node": {
    title: "Local multi-node learning path",
    goal: "Run several browser Fiber nodes side by side and compare their peer, channel, graph, payment, and shutdown behavior.",
    outcome:
      "You should understand how each local node keeps its own identity and database prefix while learning from the same public testnet graph."
  }
};

export const STEP_LESSONS: Record<StepId, StepLesson> = {
  start: {
    concept: "Node runtime",
    rpc:
      "Not JSON-RPC. Call Fiber.start(configYaml, fiberSecretKey, ckbSecretKey, undefined, logLevel, databasePrefix) in fiber-js.",
    meaning:
      "Starts the WASM Fiber node with your keys, Fiber YAML, CKB RPC, and IndexedDB prefix. This proves the browser can host the node runtime.",
    observe: "Look for a successful start before trusting any peer, channel, or payment step."
  },
  "node-info": {
    concept: "Identity",
    rpc: "Call node_info with params []. Use result.pubkey as the browser node identity.",
    meaning:
      "Reads the node public key and advertised addresses. This is the identity other Fiber peers use to recognize this browser node.",
    observe: "Confirm the pubkey is stable when you reuse the same secret key and database prefix."
  },
  "graph-channels": {
    concept: "Network graph",
    rpc: "Call graph_channels with [{ limit: \"0xffff\" }]. Count result.channels as the graph baseline.",
    meaning:
      "Queries the current graph snapshot before creating a new channel. This gives a baseline for what the node already knows.",
    observe: "A low or empty graph usually means gossip has not synced yet or peer connectivity is missing."
  },
  "connect-peer": {
    concept: "Peer connection",
    rpc:
      "Call connect_peer with [{ pubkey, save: true }], then poll list_peers [] until peers contains that pubkey.",
    meaning:
      "Connects to the configured remote Fiber pubkey. Channels and payments require a live peer session first.",
    observe: "Failures here usually point to wrong pubkey, unreachable peer, transport, or bootnode issues."
  },
  "open-channel": {
    concept: "Funding",
    rpc:
      "Call open_channel with [{ pubkey, funding_amount: hexShannonAmount, public: true }]. Store the result and then verify it through list_channels.",
    meaning:
      "Requests a channel funded by your CKB key. This is where wallet balance, CKB RPC, scripts, and fee settings become important.",
    observe: "If this fails, check the derived CKB address balance and the script cell deps in Fiber config."
  },
  "channel-ready": {
    concept: "Confirmation",
    rpc:
      "Poll list_channels with [{ pubkey, include_closed: true }] until a new channel has state_name === \"ChannelReady\" and channel_outpoint.",
    meaning:
      "Waits until the channel reaches ChannelReady. The funding transaction must be accepted and confirmed enough for Fiber to use it.",
    observe: "A long wait normally means the funding transaction is not committed or confirmations are still pending."
  },
  "graph-sync": {
    concept: "Gossip visibility",
    rpc:
      "Poll graph_channels with [{ limit: \"0xffff\" }] until one channel has the ready channel_outpoint.",
    meaning:
      "Waits until the new public channel is visible in the network graph. Routing depends on this shared graph knowledge.",
    observe: "If the channel is ready but invisible, focus on public channel flags and gossip propagation."
  },
  "send-payment": {
    concept: "Payment routing",
    rpc:
      "First call send_payment with dry_run: true. Then call send_payment with [{ target_pubkey, amount, keysend: true }] and poll get_payment by payment_hash until status is Success.",
    meaning:
      "Sends a keysend payment through the ready channel or graph route. This validates invoice-free payment execution.",
    observe: "Payment errors often separate balance, liquidity, route, and peer availability problems."
  },
  stop: {
    concept: "Lifecycle",
    rpc: "Not JSON-RPC. Call Fiber.stop() in fiber-js to stop the browser node while leaving IndexedDB data in place.",
    meaning:
      "Stops the browser Fiber node while leaving its IndexedDB state intact. This prepares the restart recovery lesson.",
    observe: "Stopping should not erase channels when the same database prefix is reused."
  },
  restart: {
    concept: "Persistence",
    rpc:
      "Not JSON-RPC. Call Fiber.start(...) again with the same keys and databasePrefix so the WASM node reloads IndexedDB state.",
    meaning:
      "Starts the node again with the same keys and database prefix. The node should reload its previous state from IndexedDB.",
    observe: "If identity or channels disappear, check the database prefix and IndexedDB cleanup history."
  },
  "restart-recovery": {
    concept: "State recovery",
    rpc:
      "Poll list_peers [] and list_channels [{ pubkey, include_closed: true }] until the peer is present and a ChannelReady channel is visible.",
    meaning:
      "Checks whether peers and channels are usable after restart. This proves the local state is durable enough for user sessions.",
    observe: "Recovery failures usually indicate stale local state, peer disconnects, or mismatched keys."
  },
  "restart-payment": {
    concept: "Post-restart payment",
    rpc:
      "Repeat the same dry_run send_payment, send_payment, and get_payment polling sequence after restart.",
    meaning:
      "Sends another payment after recovery. This proves the restored channel can still carry real activity.",
    observe: "A successful payment here is the strongest signal that restart recovery worked."
  },
  shutdown: {
    concept: "Cooperative close",
    rpc:
      "Call list_channels [], then for each ChannelReady channel call shutdown_channel with [{ channel_id, fee_rate: \"0x3FC\" }]. Poll list_channels until state_name is Closed.",
    meaning:
      "Runs shutdown_channel for ready channels. This teaches the final lifecycle stage and returns funds through the configured shutdown path.",
    observe: "After shutdown, watch for closing transaction progress and final channel state."
  },
  "local-start-nodes": {
    concept: "Multiple identities",
    rpc:
      "Not JSON-RPC. For each Local nodes JSON entry, call Fiber.start(...) with that node's Fiber key, CKB key, and databasePrefix.",
    meaning:
      "Starts every local browser node with its own Fiber key, CKB key, and database prefix.",
    observe: "Each local node should report a distinct pubkey and use its own IndexedDB namespace."
  },
  "local-node-info": {
    concept: "Node comparison",
    rpc:
      "Call node_info [] once per local Fiber instance and compare each result.pubkey.",
    meaning:
      "Collects node_info from every local node so you can compare identities before channels are opened.",
    observe: "Duplicate pubkeys mean duplicated Fiber secret keys and will make the scenario misleading."
  },
  "local-connect-peers": {
    concept: "External reachability",
    rpc:
      "For each local node, call connect_peer [{ pubkey: externalPeerPubkey, save: true }] and poll list_peers [] until that peer appears.",
    meaning:
      "Connects each local node to its configured external Fiber peer. This gives every local node a path into testnet gossip.",
    observe: "A single bad externalPeerPubkey can isolate one local node from the rest of the experiment."
  },
  "local-open-channels": {
    concept: "Parallel funding",
    rpc:
      "For each local node, call open_channel [{ pubkey: externalPeerPubkey, funding_amount, public: true }]. Track each result separately.",
    meaning:
      "Opens one public channel per local node. This shows how each local identity independently enters the network.",
    observe: "Check each derived CKB address for funded balance before starting this step."
  },
  "local-channel-ready": {
    concept: "Readiness across nodes",
    rpc:
      "For each local node, poll list_channels [{ pubkey: externalPeerPubkey, include_closed: true }] until its new channel is ChannelReady.",
    meaning:
      "Waits for every local channel to become ready. The scenario only becomes comparable once all nodes have usable channels.",
    observe: "One slow channel can block the batch; inspect per-node RPC logs to find it."
  },
  "local-graph-sync": {
    concept: "Shared graph learning",
    rpc:
      "For each observer node, poll graph_channels [{ limit: \"0xffff\" }] until it sees the other local nodes' channel_outpoint values.",
    meaning:
      "Waits until local nodes can see one another's public channels through graph gossip.",
    observe: "This proves the nodes are learning about each other through the network rather than direct local shortcuts."
  },
  "local-send-payments": {
    concept: "Cross-node payments",
    rpc:
      "For every source-target pair, call dry-run send_payment, then send_payment, then poll get_payment by payment_hash until Success.",
    meaning:
      "Attempts payments between every ordered local node pair. This turns graph knowledge into routing behavior.",
    observe: "Failures identify liquidity or route gaps between specific source and target nodes."
  },
  "local-shutdown": {
    concept: "Batch close",
    rpc:
      "For each local node, call list_channels [], shutdown_channel for every ChannelReady channel, then poll list_channels until Closed.",
    meaning:
      "Shuts down ready channels for all local nodes. This closes the experiment cleanly and teaches multi-node cleanup.",
    observe: "Use the per-node RPC log to confirm every local channel receives a shutdown attempt."
  }
};
