import { expect, test } from "bun:test"
import { add } from "./calculator"

test("adds positive numbers", () => expect(add(2, 3)).toBe(5))
test("adds zero", () => expect(add(4, 0)).toBe(4))
test("adds negative numbers", () => expect(add(-2, -3)).toBe(-5))
