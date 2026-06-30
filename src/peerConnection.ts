export type PeerConnectionTarget =
  | {
      mode: "address";
      address: string;
      expectedPubkey: string;
    }
  | {
      mode: "pubkey";
      pubkey: string;
      expectedPubkey: string;
    };

export function selectPeerConnectionTarget(input: {
  peerPubkey: string;
  peerAddress: string;
}): PeerConnectionTarget {
  const pubkey = input.peerPubkey.trim();
  const address = input.peerAddress.trim();

  if (!pubkey) {
    throw new Error("Peer pubkey is required.");
  }

  if (address) {
    return {
      mode: "address",
      address,
      expectedPubkey: pubkey
    };
  }

  return {
    mode: "pubkey",
    pubkey,
    expectedPubkey: pubkey
  };
}
