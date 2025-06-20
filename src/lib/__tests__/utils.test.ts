import { cn } from "../utils";

describe("lib/utils", () => {
  describe("cn (classNames utility)", () => {
    it("merges class names and removes duplicates", () => {
      const merged = cn("p-2", "m-1", "p-2");
      expect(merged.split(" ").sort()).toEqual(["m-1", "p-2"].sort());

      const mergedArray = cn(["text-sm", "text-sm", "font-bold"]).trim();
      expect(mergedArray.split(" ").sort()).toEqual([
        "text-sm",
        "font-bold",
      ].sort());
    });

    it("handles conditional classes", () => {
      const result = cn("base-class", true && "conditional-class", false && "hidden-class");
      expect(result).toContain("base-class");
      expect(result).toContain("conditional-class");
      expect(result).not.toContain("hidden-class");
    });

    it("handles empty inputs", () => {
      const result = cn();
      expect(result).toBe("");
    });

    it("handles null and undefined inputs", () => {
      const result = cn("valid-class", null, undefined, "another-class");
      expect(result.split(" ").sort()).toEqual(["another-class", "valid-class"].sort());
    });

    it("merges conflicting Tailwind classes correctly", () => {
      // tailwind-merge should keep the last conflicting class
      const result = cn("p-2", "p-4");
      expect(result).toBe("p-4");
    });
  });
}); 