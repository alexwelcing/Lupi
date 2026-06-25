import { useMemo, useState } from 'react';
import { useStore } from '../store';

export function SearchPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    knowledgeLabels,
    knowledgeLabelSearchQuery,
    setKnowledgeLabelSearchQuery,
    knowledgeLabelSearchFilter,
    setKnowledgeLabelSearchFilter,
    pinnedKnowledgeLabelIds,
    togglePinnedKnowledgeLabel,
    clearPinnedKnowledgeLabels,
    setSelectedAtoms,
    setCameraState,
    setActivePanel,
  } = useStore();

  const [filterOpen, setFilterOpen] = useState(false);

  const matches = useMemo(() => {
    const q = knowledgeLabelSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const filter = knowledgeLabelSearchFilter;
    return knowledgeLabels.filter((l) => {
      const textMatch = l.text.toLowerCase().includes(q);
      const nodeIdMatch = l.nodeId?.toLowerCase().includes(q) ?? false;
      const nodeKindMatch = l.nodeKind?.toLowerCase().includes(q) ?? false;
      const sphereIdMatch = l.sphereId?.toLowerCase().includes(q) ?? false;
      switch (filter) {
        case 'text': return textMatch;
        case 'nodeId': return nodeIdMatch;
        case 'nodeKind': return nodeKindMatch;
        case 'sphereId': return sphereIdMatch;
        default: return textMatch || nodeIdMatch || nodeKindMatch || sphereIdMatch;
      }
    });
  }, [knowledgeLabels, knowledgeLabelSearchQuery, knowledgeLabelSearchFilter]);

  const pinned = useMemo(
    () => knowledgeLabels.filter((l) => pinnedKnowledgeLabelIds.has(l.id)),
    [knowledgeLabels, pinnedKnowledgeLabelIds],
  );

  const handleFlyTo = (label: typeof knowledgeLabels[0]) => {
    if (label.atomIndex != null) {
      setSelectedAtoms([label.atomIndex]);
    }
    const [x, y, z] = label.position;
    setCameraState([x + 8, y + 8, z + 8], [x, y, z]);
  };

  const filterOptions: { value: typeof knowledgeLabelSearchFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'text', label: 'Text' },
    { value: 'nodeId', label: 'Node ID' },
    { value: 'nodeKind', label: 'Kind' },
    { value: 'sphereId', label: 'Sphere' },
  ];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: embedded ? 'transparent' : '#0a0a0c',
      borderLeft: embedded ? 'none' : '1px solid #1f2937',
    }}>
      {!embedded && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#121318', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 14, background: '#1edce0' }} />
            <span style={{
              fontSize: 12, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              textTransform: 'uppercase', letterSpacing: '0.15em', color: '#e2e8f0',
            }}>
              Search & Curation
            </span>
          </div>
          <button
            onClick={() => setActivePanel(null)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, background: 'transparent', border: '1px solid #334155',
              borderRadius: 0, color: '#94a3b8', cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="lupine-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search input */}
          <div>
            <input
              type="text"
              value={knowledgeLabelSearchQuery}
              onChange={(e) => setKnowledgeLabelSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches.length > 0) {
                  handleFlyTo(matches[0]);
                }
              }}
              placeholder="Search labels..."
              style={{
                width: '100%',
                background: '#121824',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 4,
                padding: '9px 10px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {matches.length > 0 && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                {matches.length} match{matches.length === 1 ? '' : 'es'}
              </div>
            )}
          </div>

          {/* Filter chips */}
          <div>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
              Filter by
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {filterOptions.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setKnowledgeLabelSearchFilter(f.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: `1px solid ${knowledgeLabelSearchFilter === f.value ? '#1edce0' : '#334155'}`,
                    background: knowledgeLabelSearchFilter === f.value ? 'rgba(30,220,224,0.12)' : '#121824',
                    color: knowledgeLabelSearchFilter === f.value ? '#9ff7ff' : '#94a3b8',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Matches list */}
          {matches.length > 0 && (
            <div style={{ border: '1px solid #1f2937', borderRadius: 6, padding: '10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Matches
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {matches.slice(0, 20).map((label) => (
                  <div
                    key={label.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 8px', background: '#121418', borderRadius: 4, border: '1px solid #1f2937',
                    }}
                  >
                    <button
                      onClick={() => handleFlyTo(label)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: 11, cursor: 'pointer', padding: 0,
                      }}
                      title="Fly to label"
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label.text}
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>
                        {label.nodeKind ?? label.kind} · {label.sphereId ?? '—'}
                      </div>
                    </button>
                    <button
                      onClick={() => togglePinnedKnowledgeLabel(label.id)}
                      style={{
                        background: 'transparent', border: 'none', color: pinnedKnowledgeLabelIds.has(label.id) ? '#1edce0' : '#64748b',
                        cursor: 'pointer', fontSize: 14, padding: '0 4px',
                      }}
                      title={pinnedKnowledgeLabelIds.has(label.id) ? 'Unpin' : 'Pin'}
                    >
                      {pinnedKnowledgeLabelIds.has(label.id) ? '★' : '☆'}
                    </button>
                  </div>
                ))}
                {matches.length > 20 && (
                  <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
                    +{matches.length - 20} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pinned list */}
          {pinned.length > 0 && (
            <div style={{ border: '1px solid #1edce0', borderRadius: 6, padding: '10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Pinned ({pinned.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinned.map((label) => (
                  <div
                    key={label.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 8px', background: '#121418', borderRadius: 4, border: '1px solid #1edce0',
                    }}
                  >
                    <button
                      onClick={() => handleFlyTo(label)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: 11, cursor: 'pointer', padding: 0,
                      }}
                    >
                      {label.text}
                    </button>
                    <button
                      onClick={() => togglePinnedKnowledgeLabel(label.id)}
                      style={{
                        background: 'transparent', border: 'none', color: '#1edce0',
                        cursor: 'pointer', fontSize: 14, padding: '0 4px',
                      }}
                      title="Unpin"
                    >
                      ★
                    </button>
                  </div>
                ))}
                <button
                  onClick={clearPinnedKnowledgeLabels}
                  style={{
                    background: 'transparent', border: '1px solid #334155', borderRadius: 4,
                    color: '#94a3b8', fontSize: 10, cursor: 'pointer', padding: '4px 8px',
                  }}
                >
                  Clear all pins
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
