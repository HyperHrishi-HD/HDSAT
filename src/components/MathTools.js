import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { MathText } from './MathText';
import { Badge, Button, Card } from './ui';
/**
 * Safe, deterministic math expression evaluator supporting standard arithmetic,
 * exponents (^), parentheses, pi, e, and common SAT functions (sqrt, abs, sin, cos, tan, log, ln).
 */
export function evaluateMathExpression(expr, xValue = 0) {
    const cleaned = expr.trim();
    if (!cleaned)
        return null;
    // Reject characters outside safe math alphabet
    if (!/^[0-9xX+\-*/^().,\sA-Za-z]+$/.test(cleaned))
        return null;
    let normalized = cleaned
        .replace(/\bpi\b/gi, '(Math.PI)')
        .replace(/\be\b/g, '(Math.E)')
        .replace(/\bsqrt\s*\(/gi, 'Math.sqrt(')
        .replace(/\babs\s*\(/gi, 'Math.abs(')
        .replace(/\bsin\s*\(/gi, 'Math.sin(')
        .replace(/\bcos\s*\(/gi, 'Math.cos(')
        .replace(/\btan\s*\(/gi, 'Math.tan(')
        .replace(/\blog\s*\(/gi, 'Math.log10(')
        .replace(/\bln\s*\(/gi, 'Math.log(')
        .replace(/\^/g, '**');
    // Implicit multiplication such as 2x -> 2*(x), 3(x+1) -> 3*(x+1)
    normalized = normalized
        .replace(/(\d)\s*([xX(])/g, '$1*$2')
        .replace(/([xX)])\s*(\d)/g, '$1*$2')
        .replace(/\)\s*\(/g, ')*(')
        .replace(/\b[xX]\b/g, `(${Number(xValue)})`);
    // Ensure no leftover identifiers other than Math.*
    const strippedMath = normalized.replace(/Math\.(PI|E|sqrt|abs|sin|cos|tan|log10|log)/g, '');
    if (/[A-Za-z_]/.test(strippedMath))
        return null;
    try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(`"use strict"; return (${normalized});`);
        const result = Number(fn());
        return Number.isFinite(result) ? result : null;
    }
    catch {
        return null;
    }
}
export function CalculatorPanel({ defaultFunctions = ['x^2 - 4x + 3', '2x - 2'] }) {
    const [expr, setExpr] = useState('3 * (4 + 5)');
    const [history, setHistory] = useState([]);
    const [fn1, setFn1] = useState(defaultFunctions[0] ?? 'x^2 - 4');
    const [fn2, setFn2] = useState(defaultFunctions[1] ?? 'x + 2');
    const [xMin, setXMin] = useState(-10);
    const [xMax, setXMax] = useState(10);
    const [probeX, setProbeX] = useState(2);
    const canvasRef = useRef(null);
    const currentResult = evaluateMathExpression(expr, probeX);
    const appendToken = (token) => {
        setExpr((prev) => `${prev}${token}`);
    };
    const evaluateToHistory = () => {
        const val = evaluateMathExpression(expr, probeX);
        if (val !== null) {
            const formatted = Number(val.toPrecision(10)).toString();
            setHistory((prev) => [{ expr, value: formatted }, ...prev.slice(0, 7)]);
        }
    };
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        const spanX = Math.max(2, xMax - xMin);
        const yMin = -spanX / 2;
        const yMax = spanX / 2;
        const toScreenX = (x) => ((x - xMin) / (xMax - xMin)) * width;
        const toScreenY = (y) => height - ((y - yMin) / (yMax - yMin)) * height;
        // Grid lines
        ctx.strokeStyle = '#e6eaf0';
        ctx.lineWidth = 1;
        const step = spanX <= 12 ? 1 : spanX <= 25 ? 2 : 5;
        for (let gx = Math.ceil(xMin / step) * step; gx <= xMax; gx += step) {
            const sx = toScreenX(gx);
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
            ctx.stroke();
        }
        for (let gy = Math.ceil(yMin / step) * step; gy <= yMax; gy += step) {
            const sy = toScreenY(gy);
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
            ctx.stroke();
        }
        // Axes
        ctx.strokeStyle = '#8b95a5';
        ctx.lineWidth = 1.5;
        const zeroX = toScreenX(0);
        const zeroY = toScreenY(0);
        ctx.beginPath();
        ctx.moveTo(zeroX, 0);
        ctx.lineTo(zeroX, height);
        ctx.moveTo(0, zeroY);
        ctx.lineTo(width, zeroY);
        ctx.stroke();
        const drawCurve = (formula, color) => {
            if (!formula.trim())
                return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            let penDown = false;
            for (let px = 0; px <= width; px += 2) {
                const x = xMin + (px / width) * (xMax - xMin);
                const y = evaluateMathExpression(formula, x);
                if (y === null || y < yMin - spanX || y > yMax + spanX) {
                    penDown = false;
                    continue;
                }
                const py = toScreenY(y);
                if (!penDown) {
                    ctx.moveTo(px, py);
                    penDown = true;
                }
                else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.stroke();
        };
        drawCurve(fn1, '#1f5fd0');
        drawCurve(fn2, '#1d7a4c');
        // Probe marker
        const y1 = evaluateMathExpression(fn1, probeX);
        if (y1 !== null) {
            ctx.fillStyle = '#1f5fd0';
            ctx.beginPath();
            ctx.arc(toScreenX(probeX), toScreenY(y1), 4.5, 0, Math.PI * 2);
            ctx.fill();
        }
        const y2 = evaluateMathExpression(fn2, probeX);
        if (y2 !== null) {
            ctx.fillStyle = '#1d7a4c';
            ctx.beginPath();
            ctx.arc(toScreenX(probeX), toScreenY(y2), 4.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }, [fn1, fn2, xMin, xMax, probeX]);
    const y1AtProbe = evaluateMathExpression(fn1, probeX);
    const y2AtProbe = evaluateMathExpression(fn2, probeX);
    return (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 10 }, children: [_jsxs("div", { children: [_jsx("h3", { children: "Scientific & Graphing Calculator" }), _jsx("p", { className: "muted", children: "Evaluate expressions or plot two functions $f(x)$ and $g(x)$ to inspect intercepts and intersections." })] }), _jsx("a", { href: "https://www.desmos.com/calculator", target: "_blank", rel: "noreferrer", className: "btn btn-outline btn-sm", children: "Open Desmos in new tab" })] }), _jsxs("div", { className: "calc-grid", children: [_jsxs("div", { className: "stack", children: [_jsxs("div", { className: "calc-screen", children: [_jsx("div", { children: expr || '0' }), _jsxs("div", { style: { fontSize: '0.88rem', color: 'var(--accent)', marginTop: 4 }, children: ["= ", currentResult !== null ? Number(currentResult.toPrecision(10)).toString() : '—'] })] }), _jsx("input", { type: "text", value: expr, onChange: (e) => setExpr(e.target.value), placeholder: "e.g. (180 - 36) / 2 or sqrt(144)", "aria-label": "Calculator expression" }), _jsxs("div", { className: "calc-keys", children: [['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '^', '+'].map((k) => (_jsx("button", { type: "button", onClick: () => appendToken(k), children: k }, k))), _jsx("button", { type: "button", onClick: () => appendToken('sqrt('), children: "sqrt" }), _jsx("button", { type: "button", onClick: () => appendToken('('), children: "(" }), _jsx("button", { type: "button", onClick: () => appendToken(')'), children: ")" }), _jsx("button", { type: "button", onClick: () => setExpr(''), children: "C" })] }), _jsx(Button, { onClick: evaluateToHistory, size: "sm", children: "Record calculation" }), history.length > 0 ? (_jsx("div", { className: "muted-block", style: { fontSize: '0.82rem' }, children: history.map((item, idx) => (_jsxs("div", { className: "row-between", children: [_jsx("span", { className: "mono", children: item.expr }), _jsxs("strong", { className: "mono", children: ["= ", item.value] })] }, idx))) })) : null] }), _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "grid-2", children: [_jsxs("label", { className: "field", style: { marginBottom: 0 }, children: [_jsx("span", { className: "field-label", style: { color: '#1f5fd0' }, children: "f(x) (blue)" }), _jsx("input", { type: "text", value: fn1, onChange: (e) => setFn1(e.target.value), placeholder: "e.g. x^2 - 4x + 3" })] }), _jsxs("label", { className: "field", style: { marginBottom: 0 }, children: [_jsx("span", { className: "field-label", style: { color: '#1d7a4c' }, children: "g(x) (green)" }), _jsx("input", { type: "text", value: fn2, onChange: (e) => setFn2(e.target.value), placeholder: "e.g. 2x - 2" })] })] }), _jsx("canvas", { ref: canvasRef, width: 520, height: 260, className: "plot" }), _jsxs("div", { className: "row-between", children: [_jsxs("div", { className: "row", children: [_jsxs("label", { className: "row", style: { fontSize: '0.82rem' }, children: [_jsx("span", { children: "Inspect x =" }), _jsx("input", { type: "text", value: String(probeX), onChange: (e) => {
                                                            const n = Number(e.target.value);
                                                            if (Number.isFinite(n))
                                                                setProbeX(n);
                                                        }, style: { width: 72 } })] }), _jsxs(Badge, { tone: "info", children: ["f(", probeX, ") = ", y1AtProbe !== null ? Number(y1AtProbe.toFixed(3)) : '—'] }), _jsxs(Badge, { tone: "good", children: ["g(", probeX, ") = ", y2AtProbe !== null ? Number(y2AtProbe.toFixed(3)) : '—'] })] }), _jsxs("div", { className: "row", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                    setXMin((v) => v * 0.75);
                                                    setXMax((v) => v * 0.75);
                                                }, children: "Zoom in" }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => {
                                                    setXMin(-10);
                                                    setXMax(10);
                                                }, children: "Reset [-10, 10]" })] })] })] })] })] }));
}
const REFERENCE_FORMULAS = [
    { name: 'Circle area & circumference', latex: '$A = \\pi r^2,\\quad C = 2\\pi r$' },
    { name: 'Rectangle & triangle area', latex: '$A_{\\text{rect}} = \\ell w,\\quad A_{\\text{tri}} = \\tfrac{1}{2}bh$' },
    { name: 'Pythagorean theorem', latex: '$a^2 + b^2 = c^2$' },
    { name: 'Special right triangles', latex: '$30^\\circ\\text{-}60^\\circ\\text{-}90^\\circ: x,\\, x\\sqrt{3},\\, 2x \\quad | \\quad 45^\\circ\\text{-}45^\\circ\\text{-}90^\\circ: s,\\, s,\\, s\\sqrt{2}$' },
    { name: 'Rectangular prism & cylinder volume', latex: '$V_{\\text{box}} = \\ell w h,\\quad V_{\\text{cyl}} = \\pi r^2 h$' },
    { name: 'Sphere, cone & pyramid volume', latex: '$V_{\\text{sphere}} = \\tfrac{4}{3}\\pi r^3,\\quad V_{\\text{cone}} = \\tfrac{1}{3}\\pi r^2 h,\\quad V_{\\text{pyr}} = \\tfrac{1}{3}\\ell w h$' },
    { name: 'Angle Facts', latex: 'Circle $= 360^\\circ = 2\\pi$ rad; Triangle interior sum $= 180^\\circ$' },
];
export function MathReferenceSheet() {
    return (_jsxs(Card, { children: [_jsx("h3", { children: "SAT Suite Math Reference Sheet" }), _jsx("p", { className: "muted", children: "Standard geometry and measurement formulas provided during every Digital SAT and PSAT Math module." }), _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Topic" }), _jsx("th", { children: "Formula / Relationship" })] }) }), _jsx("tbody", { children: REFERENCE_FORMULAS.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("strong", { children: row.name }) }), _jsx("td", { children: _jsx(MathText, { text: row.latex }) })] }, row.name))) })] })] }));
}
