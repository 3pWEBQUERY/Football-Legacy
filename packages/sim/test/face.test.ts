import { describe, expect, it } from "vitest";
import { faceSpec, faceSvg } from "../src";

const player = (id: number, nationality = "GER", age = 24) => ({ id, name: `Spieler ${id}`, age, nationality });

describe("Spielergesichter", () => {
  it("erzeugt für denselben Spieler immer dasselbe Gesicht", () => {
    expect(faceSvg(player(7))).toBe(faceSvg(player(7)));
  });

  it("gibt verschiedenen Spielern verschiedene Gesichter", () => {
    const svgs = new Set(Array.from({ length: 200 }, (_, i) => faceSvg(player(i + 1))));
    expect(svgs.size).toBe(200);
    const looks = new Set(Array.from({ length: 200 }, (_, i) => {
      const f = faceSpec(player(i + 1));
      return `${f.skin}|${f.hairColor}|${f.style}|${f.beard}|${f.eyeColor}`;
    }));
    expect(looks.size).toBeGreaterThan(80);
  });

  it("richtet Hautton und Haare nach der Herkunft", () => {
    const avgSkin = (nat: string) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += faceSpec(player(i, nat)).skin;
      return sum / 300;
    };
    expect(avgSkin("NGA")).toBeGreaterThan(6.5);
    expect(avgSkin("NOR")).toBeLessThan(2);
    expect(avgSkin("NGA")).toBeGreaterThan(avgSkin("BRA"));
  });

  it("lässt Spieler mit dem Alter grau werden", () => {
    const id = Array.from({ length: 400 }, (_, i) => i).find((i) => faceSpec(player(i)).greyAge < 34)!;
    expect(faceSvg(player(id, "GER", 22))).not.toBe(faceSvg(player(id, "GER", 38)));
  });

  it("übernimmt nur gültige Trikotfarben", () => {
    const svg = faceSvg(player(3), { primary: "red\"/><script>", secondary: "#fff" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("#fff");
  });
});
