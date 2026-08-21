import type { CalcExpr, CalcFunctionName } from "./ast";

/**
 * ADR 0037 decision 9. `missing_input` covers a `{ref}` absent from the
 * caller's `inputs` map. `non_finite` covers division by zero and any
 * non-finite intermediate (overflow, `Infinity - Infinity`, …) — both are
 * "this node's result failed `Number.isFinite`", so one code serves both; the
 * ADR names them as examples of the same check, not as separate codes.
 * `invalid_clamp_range` is `clamp(x, lo, hi)` called with `lo > hi`, which is
 * a bad argument rather than a non-finite result.
 */
export type CalcEvalErrorCode = "missing_input" | "non_finite" | "invalid_clamp_range";

export type CalcEvalResult =
  | { ok: true; value: number }
  | { ok: false; code: CalcEvalErrorCode; position: number };

/** `-0` is never a distinct result from `0` in this DSL (ADR 0037 decision 9). */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function finiteOrFail(value: number, position: number): CalcEvalResult {
  if (!Number.isFinite(value)) {
    return { ok: false, code: "non_finite", position };
  }
  return { ok: true, value: normalizeZero(value) };
}

function applyBinaryOp(op: "+" | "-" | "*" | "/", left: number, right: number): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
  }
}

/** `Math.round` already breaks ties toward `+Infinity`, but `Math.round(-0.5)`
 * is `-0`, which `finiteOrFail`'s `normalizeZero` turns into `0` — that is
 * where `round(-0.5) === 0` actually comes from, not from this function. */
function applyFunction(fn: CalcFunctionName, args: number[]): { value: number } | { code: CalcEvalErrorCode } {
  switch (fn) {
    case "abs":
      return { value: Math.abs(args[0]) };
    case "round":
      return { value: Math.round(args[0]) };
    case "min":
      return { value: Math.min(...args) };
    case "max":
      return { value: Math.max(...args) };
    case "clamp": {
      const [x, lo, hi] = args;
      if (lo > hi) {
        return { code: "invalid_clamp_range" };
      }
      return { value: Math.min(Math.max(x, lo), hi) };
    }
  }
}

function evalNode(node: CalcExpr, inputs: ReadonlyMap<string, number>): CalcEvalResult {
  switch (node.kind) {
    case "number":
      return { ok: true, value: node.value };

    case "ref": {
      const value = inputs.get(node.pointKey);
      if (value === undefined) {
        return { ok: false, code: "missing_input", position: node.position };
      }
      // Routed through the same finiteness gate as every other node
      // (decision 9): today every real caller resolves refs from
      // `point_values`, which migration 0031's finite-check constraint
      // already keeps finite, so this is unreachable via the live write
      // path — but the DSL evaluator is not allowed to assume its caller.
      return finiteOrFail(value, node.position);
    }

    case "unary": {
      const operand = evalNode(node.operand, inputs);
      if (!operand.ok) {
        return operand;
      }
      return finiteOrFail(-operand.value, node.position);
    }

    case "binary": {
      const left = evalNode(node.left, inputs);
      if (!left.ok) {
        return left;
      }
      const right = evalNode(node.right, inputs);
      if (!right.ok) {
        return right;
      }
      return finiteOrFail(applyBinaryOp(node.op, left.value, right.value), node.position);
    }

    case "call": {
      const args: number[] = [];
      for (const argNode of node.args) {
        const arg = evalNode(argNode, inputs);
        if (!arg.ok) {
          return arg;
        }
        args.push(arg.value);
      }
      const result = applyFunction(node.fn, args);
      if ("code" in result) {
        return { ok: false, code: result.code, position: node.position };
      }
      return finiteOrFail(result.value, node.position);
    }
  }
}

/**
 * Evaluates a parsed `bms-calc-v1` expression against resolved input values.
 * Pure — no clock, no database, no configuration (ADR 0037 decision 1).
 * Staleness is the caller's job, resolved before this runs (decision 5); this
 * function only ever sees values already decided to be usable.
 *
 * Checks finiteness at every node, not only the root (decision 9): a chain
 * like `({A} * {B}) - ({A} * {B})` refuses at the first multiply, not at the
 * subtraction, even though the subtraction's own inputs would already be
 * non-finite and `Infinity - Infinity` is `NaN` either way — the position
 * reported is the node that actually produced the non-finite value.
 */
export function evaluate(ast: CalcExpr, inputs: ReadonlyMap<string, number>): CalcEvalResult {
  return evalNode(ast, inputs);
}
