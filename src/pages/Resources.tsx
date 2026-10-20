import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Field, Select } from '../components/ui';
import { useApp } from '../lib/store';

export function ResourcesPage() {
  const app = useApp();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const allTags = useMemo(() => {
    const s = new Set<string>();
    app.resources.forEach((r) => r.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [app.resources]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return app.resources.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (tagFilter !== 'all' && !r.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.provider.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [app.resources, search, typeFilter, tagFilter]);

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <h1>SAT &amp; PSAT Study Resource Library</h1>
            <p className="muted">
              Curated, verified external references, open textbooks (CC BY 4.0), and official specification guides.
            </p>
          </div>
          <Badge tone="info">{filtered.length} resources</Badge>
        </div>

        <div className="card-grid" style={{ marginTop: 12 }}>
          <Field label="Search title, provider, or topic">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. OpenStax, grammar, Desmos, Bluebook..."
            />
          </Field>
          <Select
            label="Resource Type"
            mode="dropdown"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'reference', label: 'Official References & Specs' },
              { value: 'course', label: 'Interactive Courses & Guides' },
              { value: 'textbook', label: 'Open Textbooks (CC BY 4.0)' },
              { value: 'tool', label: 'Testing & Calculator Tools' },
            ]}
          />
          <Select
            label="Topic Tag"
            value={tagFilter}
            onChange={setTagFilter}
            options={[
              { value: 'all', label: 'All Tags' },
              ...allTags.map((t) => ({ value: t, label: t })),
            ]}
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No resources match your search"
            body="Try clearing the search term or selecting 'All Types'."
          />
        </Card>
      ) : (
        <div className="grid-2">
          {filtered.map((res) => (
            <Card key={res.id}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <Badge tone="info">{res.type}</Badge>
                <Badge tone="good">{res.cost}</Badge>
              </div>
              <h3>{res.title}</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Provider: <strong>{res.provider}</strong>
              </p>
              <p>{res.description}</p>
              <div className="row-between" style={{ marginTop: 12 }}>
                <div className="row">
                  {res.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
                <a href={res.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                  Open resource ↗
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
