import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Card({ children, className = '', as: Tag = 'section', }) {
    return _jsx(Tag, { className: `card ${className}`.trim(), children: children });
}
export function Button({ children, onClick, variant = 'primary', size = 'md', type = 'button', disabled = false, full = false, title, }) {
    return (_jsx("button", { type: type, className: `btn btn-${variant} btn-${size}${full ? ' btn-full' : ''}`, onClick: onClick, disabled: disabled, title: title, children: children }));
}
export function Stat({ label, value, hint, }) {
    return (_jsxs("div", { className: "stat", children: [_jsx("span", { className: "stat-label", children: label }), _jsx("span", { className: "stat-value", children: value }), hint ? _jsx("span", { className: "stat-hint", children: hint }) : null] }));
}
export function Badge({ children, tone = 'neutral', }) {
    return _jsx("span", { className: `badge badge-${tone}`, children: children });
}
export function ProgressBar({ value, max = 1 }) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (_jsx("div", { className: "progress", role: "progressbar", "aria-valuenow": Math.round(pct), "aria-valuemin": 0, "aria-valuemax": 100, children: _jsx("div", { className: "progress-fill", style: { width: `${pct}%` } }) }));
}
export function EmptyState({ title, body, action, }) {
    return (_jsxs("div", { className: "empty", children: [_jsx("h3", { children: title }), _jsx("p", { children: body }), action] }));
}
export function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "field", children: [_jsx("span", { className: "field-label", children: label }), children, hint ? _jsx("span", { className: "field-hint", children: hint }) : null] }));
}
export function Select({ value, onChange, options, label, }) {
    return (_jsxs("label", { className: "field", children: [_jsx("span", { className: "field-label", children: label }), _jsx("select", { value: value, onChange: (event) => onChange(event.target.value), children: options.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }));
}
export function Toggle({ checked, onChange, label, hint, }) {
    return (_jsxs("label", { className: "toggle", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: label }), hint ? _jsx("em", { children: hint }) : null] })] }));
}
export function Alert({ tone, children, onDismiss, }) {
    return (_jsxs("div", { className: `alert alert-${tone}`, role: tone === 'error' ? 'alert' : 'status', children: [_jsx("span", { children: children }), onDismiss ? (_jsx("button", { type: "button", className: "alert-close", onClick: onDismiss, "aria-label": "Dismiss", children: "x" })) : null] }));
}
