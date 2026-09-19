import { Position } from "vscode-languageserver-types";
import * as geometry from "m68k-parser";
import { range } from "./helpers";

describe("geometry", () => {
  describe("#isBeforeOrEqual()", () => {
    it("returns true if before", async () => {
      const res = geometry.isBeforeOrEqual(
        Position.create(0, 0),
        Position.create(0, 1),
      );
      expect(res).toBeTruthy();
    });

    it("returns true if equal", async () => {
      const res = geometry.isBeforeOrEqual(
        Position.create(0, 1),
        Position.create(0, 1),
      );
      expect(res).toBeTruthy();
    });

    it("returns false if after", async () => {
      const res = geometry.isBeforeOrEqual(
        Position.create(0, 1),
        Position.create(0, 0),
      );
      expect(res).toBeFalsy();
    });
  });

  describe("#containsPosition()", () => {
    it("returns true if in range", async () => {
      const res = geometry.containsPosition(
        range(0, 0, 1, 10),
        Position.create(0, 1),
      );
      expect(res).toBeTruthy();
    });

    it("returns false if not in range", async () => {
      const res = geometry.containsPosition(
        range(0, 0, 1, 10),
        Position.create(2, 1),
      );
      expect(res).toBeFalsy();
    });
  });

  describe("#containsRange()", () => {
    it("returns true if in range", async () => {
      const res = geometry.containsRange(range(0, 0, 1, 10), range(0, 0, 1, 5));
      expect(res).toBeTruthy();
    });

    it("returns false if not in range", async () => {
      const res = geometry.containsRange(range(0, 0, 1, 10), range(0, 0, 2, 1));
      expect(res).toBeFalsy();
    });
  });
});
