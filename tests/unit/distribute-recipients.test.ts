import { describe, expect, it } from "vitest";
import { groupSendList } from "../../src/lib/emails/group-send";
import { buildGroupSendOwners } from "../../scripts/distribute/lib/recipients";
import type { EntryRow, OwnerRow } from "../../scripts/lib/db";

const owner = (id: string, first: string, last: string, email: string | null, status = "confirmed"): OwnerRow => ({
  id,
  first_name: first,
  last_name: last,
  email,
  participation_status: status,
});

const entry = (id: string, ownerId: string, name: string, extra: Partial<EntryRow> = {}): EntryRow => ({
  id,
  owner_id: ownerId,
  entry_name: name,
  player_email: null,
  is_gifted: false,
  is_free_entry: false,
  lynne_number: null,
  lynne_label: null,
  voided_at: null,
  ...extra,
});

const KRIS = owner("o1", "Kris", "Tomasco", "kris@x.com");
const JOHN = owner("o2", "John", "Vassallo", "john@x.com", "declined");
const PUMPY = owner("o3", "", "Pumpy321", "p@x.com");
const NOMAIL = owner("o4", "No", "Address", null);
const SAME = owner("o5", "Kris", "Again", "KRIS@x.com");

const ENTRIES: EntryRow[] = [
  entry("e1", "o1", "Kris Tomasco #1"),
  entry("e2", "o1", "Chas Flaster #1", { is_gifted: true, player_email: "chas@x.com" }),
  entry("e3", "o1", "Chas Flaster #2", { is_gifted: true, player_email: "chas@x.com" }),
  entry("e4", "o2", "John Vassallo #1", { voided_at: "2026-09-04T00:00:00Z" }),
  entry("e5", "o3", "Pumpy321"),
  entry("e6", "o1", "Gone Gift", { is_gifted: true, player_email: "gone@x.com", voided_at: "2026-09-04T00:00:00Z" }),
  entry("e7", "o4", "Nobody Home"),
];

describe("buildGroupSendOwners", () => {
  it("includes a giftee's player_email under the owner who bought the entry", () => {
    const out = buildGroupSendOwners([KRIS, PUMPY], ENTRIES);
    expect(out.map((o) => o.id)).toEqual(["o1", "o3"]);
    expect(out[0]).toEqual({ id: "o1", name: "Kris Tomasco", email: "kris@x.com", players: ["chas@x.com", "chas@x.com"] });
    expect(out[1]).toEqual({ id: "o3", name: "Pumpy321", email: "p@x.com", players: [] });
  });

  it("leaves out a declined owner and the giftee of a voided entry", () => {
    const out = buildGroupSendOwners([KRIS, JOHN], ENTRIES);
    expect(out.map((o) => o.id)).toEqual(["o1"]);
    expect(out[0].players).not.toContain("gone@x.com");
  });

  it("emits an owner listed twice once, in roster order", () => {
    const out = buildGroupSendOwners([PUMPY, KRIS, PUMPY], ENTRIES);
    expect(out.map((o) => o.id)).toEqual(["o3", "o1"]);
  });

  it("keeps an owner with no address, so the list can report them", () => {
    const out = buildGroupSendOwners([NOMAIL], ENTRIES);
    expect(out).toEqual([{ id: "o4", name: "No Address", email: null, players: [] }]);
  });
});

describe("through groupSendList with giftees on", () => {
  it("lands every owner address and the giftee once each, and names the gaps", () => {
    const list = groupSendList(buildGroupSendOwners([KRIS, JOHN, PUMPY, NOMAIL], ENTRIES), {
      includeGiftedPlayers: true,
    });
    expect(list.addresses).toEqual(["kris@x.com", "chas@x.com", "p@x.com"]);
    expect(list.missingEmail.map((o) => o.name)).toEqual(["No Address"]);
    expect(list.giftedPlayers).toEqual([{ ownerId: "o1", ownerName: "Kris Tomasco", address: "chas@x.com" }]);
    expect(list.duplicates).toEqual([]);
  });

  it("collapses one mailbox on two owner rows to one address and reports the second row", () => {
    const list = groupSendList(buildGroupSendOwners([KRIS, SAME], ENTRIES), { includeGiftedPlayers: true });
    expect(list.addresses).toEqual(["kris@x.com", "chas@x.com"]);
    expect(list.duplicates).toEqual([{ ownerId: "o5", ownerName: "Kris Again", address: "KRIS@x.com" }]);
  });
});
