import { useState, useRef } from "react";
import type { Track, EditableField } from "../types";
import { EDITABLE_FIELDS } from "../types";
import { patchTrack, bulkPatch, uploadArtwork, artworkUrl } from "../api";

interface Props {
  tracks: Track[]; // 1 = single edit, >1 = bulk edit
  onClose: () => void;
  onSaved: () => void;
}

export default function EditModal({ tracks, onClose, onSaved }: Props) {
  const bulk = tracks.length > 1;
  const single = tracks[0];

  // For single edit, prefill from the track. For bulk, start empty (only
  // fields the user fills get applied to all selected tracks).
  const initial = () => {
    const o: Record<EditableField, string> = {} as Record<EditableField, string>;
    for (const { key } of EDITABLE_FIELDS) {
      o[key] = bulk ? "" : (single[key] ?? "");
    }
    return o;
  };

  const [values, setValues] = useState<Record<EditableField, string>>(initial);
  const [dirty, setDirty] = useState<Set<EditableField>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [artVersion, setArtVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (key: EditableField, v: string) => {
    setValues((p) => ({ ...p, [key]: v }));
    setDirty((p) => new Set(p).add(key));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send fields the user actually touched.
      const changes: Record<string, string | null> = {};
      for (const { key } of EDITABLE_FIELDS) {
        if (dirty.has(key)) changes[key] = values[key] === "" ? null : values[key];
      }
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      if (bulk) {
        await bulkPatch(tracks.map((t) => t.id), changes);
      } else {
        await patchTrack(single.id, changes);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onPickArt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await uploadArtwork(single.id, file);
      setArtVersion((v) => v + 1);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{bulk ? `Edit ${tracks.length} tracks` : "Edit track"}</h2>

        {!bulk && (
          <div className="art-edit">
            {single.has_artwork ? (
              <img src={`${artworkUrl(single.id)}?v=${artVersion}`} alt="cover" />
            ) : (
              <div className="art-placeholder" />
            )}
            <div>
              <button onClick={() => fileRef.current?.click()} disabled={saving}>
                Change artwork
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                hidden
                onChange={onPickArt}
              />
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {single.filename}
              </div>
            </div>
          </div>
        )}

        {bulk && (
          <p className="muted" style={{ marginTop: 0 }}>
            Only fields you fill in will be applied to all selected tracks.
          </p>
        )}

        {EDITABLE_FIELDS.map(({ key, label }) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input
              type="text"
              value={values[key]}
              placeholder={bulk ? "(leave blank to keep)" : ""}
              onChange={(e) => setField(key, e.target.value)}
            />
          </div>
        ))}

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
