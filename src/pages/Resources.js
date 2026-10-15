import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Field, Select } from '../components/ui';
import { useApp } from '../lib/store';
export function ResourcesPage() {
    const app = useApp();
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [tagFilter, setTagFilter] = useState('all');
    const allTags = useMemo(() => {
        const s = new Set();
        app.resources.forEach((r) => r.tags.forEach((t) => s.add(t)));
        return Array.from(s).sort();
    }, [app.resources]);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return app.resources.filter((r) => {
            if (typeFilter !== 'all' && r.type !== typeFilter)
                return false;
            if (tagFilter !== 'all' && !r.tags.includes(tagFilter))
                return false;
            if (!q)
                return true;
            return (r.title.toLowerCase().includes(q) ||
                r.provider.toLowerCase().includes(q) ||
                r.description.toLowerCase().includes(q) ||
                r.tags.some((t) => t.toLowerCase().includes(q)));
        });
    }, [app.resources, search, typeFilter, tagFilter]);
    return (_jsxs("div", { children: [_jsxs(Card, { children: [_jsxs("div", { className: "row-between", children: [_jsxs("div", { children: [_jsx("h1", { children: "SAT & PSAT Study Resource Library" }), _jsx("p", { className: "muted", children: "Curated, verified external references, open textbooks (CC BY 4.0), and official specification guides." })] }), _jsxs(Badge, { tone: "info", children: [filtered.length, " resources"] })] }), _jsxs("div", { className: "card-grid", style: { marginTop: 12 }, children: [_jsx(Field, { label: "Search title, provider, or topic", children: _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "e.g. OpenStax, grammar, Desmos, Bluebook..." }) }), _jsx(Select, { label: "Resource Type", value: typeFilter, onChange: setTypeFilter, options: [
                                    { value: 'all', label: 'All Types' },
                                    { value: 'reference', label: 'Official References & Specs' },
                                    { value: 'course', label: 'Interactive Courses & Guides' },
                                    { value: 'textbook', label: 'Open Textbooks (CC BY 4.0)' },
                                    { value: 'tool', label: 'Testing & Calculator Tools' },
                                ] }), _jsx(Select, { label: "Topic Tag", value: tagFilter, onChange: setTagFilter, options: [
                                    { value: 'all', label: 'All Tags' },
                                    ...allTags.map((t) => ({ value: t, label: t })),
                                ] })] })] }), filtered.length === 0 ? (_jsx(Card, { children: _jsx(EmptyState, { title: "No resources match your search", body: "Try clearing the search term or selecting 'All Types'." }) })) : (_jsx("div", { className: "grid-2", children: filtered.map((res) => (_jsxs(Card, { children: [_jsxs("div", { className: "row-between", style: { marginBottom: 6 }, children: [_jsx(Badge, { tone: "info", children: res.type }), _jsx(Badge, { tone: "good", children: res.cost })] }), _jsx("h3", { children: res.title }), _jsxs("p", { className: "muted", style: { marginBottom: 8 }, children: ["Provider: ", _jsx("strong", { children: res.provider })] }), _jsx("p", { children: res.description }), _jsxs("div", { className: "row-between", style: { marginTop: 12 }, children: [_jsx("div", { className: "row", children: res.tags.map((t) => (_jsx(Badge, { children: t }, t))) }), _jsx("a", { href: res.url, target: "_blank", rel: "noreferrer", className: "btn btn-outline btn-sm", children: "Open resource \u2197" })] })] }, res.id))) }))] }));
}
