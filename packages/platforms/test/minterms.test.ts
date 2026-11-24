import { describeMinterm } from "../src/index";

// Table 6-1 of the Hardware Reference Manual, "Table of Common Minterm
// Values", with its overbars written as ¬.
describe("describeMinterm", () => {
  test.each([
    [0xf0, "D = A"],
    [0x0f, "D = ¬A"],
    [0xcc, "D = B"],
    [0x33, "D = ¬B"],
    [0xaa, "D = C"],
    [0x55, "D = ¬C"],
    [0xa0, "D = AC"],
    [0x50, "D = A¬C"],
    [0x0a, "D = ¬AC"],
    [0x05, "D = ¬A¬C"],
    [0xfc, "D = A + B"],
    [0xcf, "D = ¬A + B"],
    [0xfa, "D = A + C"],
    [0xaf, "D = ¬A + C"],
    [0xee, "D = B + C"],
    [0xbb, "D = ¬B + C"],
    [0xc0, "D = AB"],
    [0x30, "D = A¬B"],
    [0x0c, "D = ¬AB"],
    [0x03, "D = ¬A¬B"],
    [0x88, "D = BC"],
    [0x44, "D = B¬C"],
    [0x22, "D = ¬BC"],
    [0x11, "D = ¬B¬C"],
    [0xf3, "D = A + ¬B"],
    [0x3f, "D = ¬A + ¬B"],
    [0xf5, "D = A + ¬C"],
    [0x5f, "D = ¬A + ¬C"],
    [0xdd, "D = B + ¬C"],
    [0x77, "D = ¬B + ¬C"],
    [0xca, "D = AB + ¬AC"],
  ])("$%s is %s", (lf, equation) => {
    expect(describeMinterm(lf).equation).toBe(equation);
  });

  test("covers the constants, and names the common functions", () => {
    expect(describeMinterm(0x00)).toEqual({ equation: "D = 0", name: "clear" });
    expect(describeMinterm(0xff)).toEqual({ equation: "D = 1", name: "set" });
    expect(describeMinterm(0xca).name).toBe("cookie-cut");
    expect(describeMinterm(0xf0).name).toBe("copy A");
    expect(describeMinterm(0xc8).name).toBeUndefined();
  });

  test("writes any function with as few products as it needs", () => {
    // From the manual's Venn diagram example: AB + BC is $C8.
    expect(describeMinterm(0xc8).equation).toBe("D = AB + BC");
    // Exclusive OR of A and C needs two products.
    expect(describeMinterm(0x5a).equation).toBe("D = A¬C + ¬AC");
    // The line-drawing function, $4A.
    expect(describeMinterm(0x4a).equation).toBe("D = ¬AC + AB¬C");
  });

  test("every function's equation gives back its bits", () => {
    for (let lf = 0; lf < 256; lf++) {
      const { equation } = describeMinterm(lf);
      const products = equation.slice(4).split(" + ");
      let bits = 0;
      for (let n = 0; n < 8; n++) {
        const value = { A: (n >> 2) & 1, B: (n >> 1) & 1, C: n & 1 };
        const holds = products.some((product) =>
          product === "1"
            ? true
            : product !== "0" &&
              [...product.matchAll(/(¬?)([ABC])/g)].every(
                ([, not, s]) => value[s as "A" | "B" | "C"] === (not ? 0 : 1),
              ),
        );
        if (holds) bits |= 1 << n;
      }
      expect([lf, bits]).toEqual([lf, lf]);
    }
  });
});
