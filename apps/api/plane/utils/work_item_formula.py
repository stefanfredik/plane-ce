# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Formula properties: arithmetic over the number properties of the same type.

A formula names other properties in braces, e.g. ``{Impact} * {Likelihood} + 1``.
Only numbers, the four operators, unary minus and parentheses are accepted; the
expression is parsed with ``ast`` and walked by hand, never ``eval``-ed.
"""

# Python imports
import ast
import re
from decimal import Decimal, DivisionByZero, InvalidOperation

REFERENCE = re.compile(r"\{([^{}]+)\}")
MAX_FORMULA_LENGTH = 500

_BINARY = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
}


class FormulaError(ValueError):
    pass


def references(formula):
    """Property names used by a formula, in order of appearance."""
    return [name.strip() for name in REFERENCE.findall(formula or "")]


def _compile(formula):
    """Replace each {Name} with a placeholder variable and parse the result."""
    if not formula or len(formula) > MAX_FORMULA_LENGTH:
        raise FormulaError("A formula is required (up to 500 characters).")
    names = []

    def placeholder(match):
        name = match.group(1).strip()
        if name not in names:
            names.append(name)
        return f"v{names.index(name)}"

    source = REFERENCE.sub(placeholder, formula)
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError:
        raise FormulaError("The formula is not valid arithmetic.")
    for node in ast.walk(tree):
        if not isinstance(
            node,
            (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load, ast.USub, ast.UAdd)
            + tuple(_BINARY),
        ):
            raise FormulaError("Only numbers, + - * / and parentheses are allowed.")
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise FormulaError("Only numbers, + - * / and parentheses are allowed.")
        if isinstance(node, ast.Name) and not re.fullmatch(r"v\d+", node.id):
            raise FormulaError("Refer to properties as {Property name}.")
    return tree, names


def validate(formula, available_names):
    """Raise FormulaError unless the formula parses and only names available number properties."""
    _tree, names = _compile(formula)
    if not names:
        raise FormulaError("A formula must use at least one number property, e.g. {Impact} * 2.")
    lowered = {name.lower() for name in available_names}
    missing = [name for name in names if name.lower() not in lowered]
    if missing:
        raise FormulaError(f"Unknown number properties: {', '.join(missing)}.")


def evaluate(formula, values_by_name):
    """The formula's value, or None when an input is missing or the maths is undefined (e.g. / 0)."""
    tree, names = _compile(formula)
    lookup = {k.lower(): v for k, v in values_by_name.items()}
    variables = {}
    for index, name in enumerate(names):
        value = lookup.get(name.lower())
        if value is None:
            return None
        variables[f"v{index}"] = Decimal(str(value))

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant):
            return Decimal(str(node.value))
        if isinstance(node, ast.Name):
            return variables[node.id]
        if isinstance(node, ast.UnaryOp):
            operand = walk(node.operand)
            return -operand if isinstance(node.op, ast.USub) else operand
        if isinstance(node, ast.BinOp):
            return _BINARY[type(node.op)](walk(node.left), walk(node.right))
        raise FormulaError("Unsupported expression")

    try:
        result = walk(tree)
    except (DivisionByZero, InvalidOperation, ZeroDivisionError):
        return None
    if not result.is_finite():
        return None
    return result.quantize(Decimal("0.0001")).normalize()
