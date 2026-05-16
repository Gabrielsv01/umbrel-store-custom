import { useState } from 'react';
import type { CustomToolParameter } from '../../types/customTools';

interface ParameterEditorProps {
  parameters: Record<string, CustomToolParameter>;
  onChange: (parameters: Record<string, CustomToolParameter>) => void;
}

export default function ParameterEditor({
  parameters,
  onChange,
}: ParameterEditorProps) {
  const [showAddParam, setShowAddParam] = useState(false);
  const [newParamName, setNewParamName] = useState('');
  const [newParamType, setNewParamType] = useState<
    'string' | 'number' | 'boolean' | 'object'
  >('string');

  const handleAddParameter = () => {
    if (!newParamName.trim()) return;

    const newParams = {
      ...parameters,
      [newParamName]: {
        type: newParamType,
        description: '',
        required: true,
      },
    };

    onChange(newParams);
    setNewParamName('');
    setNewParamType('string');
    setShowAddParam(false);
  };

  const handleRemoveParameter = (name: string) => {
    const newParams = { ...parameters };
    delete newParams[name];
    onChange(newParams);
  };

  const handleUpdateParameter = (
    name: string,
    param: CustomToolParameter
  ) => {
    const newParams = { ...parameters };
    newParams[name] = param;
    onChange(newParams);
  };

  const handleRenameParameter = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;

    const newParams = { ...parameters };
    const param = newParams[oldName];
    delete newParams[oldName];
    newParams[newName] = param;
    onChange(newParams);
  };

  return (
    <div className="mt-2 rounded border border-gray-700 bg-gray-800 p-3">
      {Object.entries(parameters).length === 0 ? (
        <p className="text-xs text-gray-400">No parameters added</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(parameters).map(([name, param]) => (
            <div key={name} className="rounded border border-gray-600 bg-gray-700 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleRenameParameter(name, e.target.value)}
                  className="flex-1 rounded border border-gray-600 bg-gray-600 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
                <select
                  value={param.type}
                  onChange={(e) =>
                    handleUpdateParameter(name, {
                      ...param,
                      type: e.target.value as CustomToolParameter['type'],
                    })
                  }
                  className="rounded border border-gray-600 bg-gray-600 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="object">object</option>
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={param.required ?? false}
                    onChange={(e) =>
                      handleUpdateParameter(name, {
                        ...param,
                        required: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-gray-300">Required</span>
                </label>
                <button
                  onClick={() => handleRemoveParameter(name)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>

              <input
                type="text"
                value={param.description}
                onChange={(e) =>
                  handleUpdateParameter(name, {
                    ...param,
                    description: e.target.value,
                  })
                }
                placeholder="Description..."
                className="w-full rounded border border-gray-600 bg-gray-600 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />

              {/* Enum values */}
              {param.type === 'string' && (
                <div className="mt-2">
                  <label className="block text-xs text-gray-400">
                    Allowed values (comma-separated, optional)
                  </label>
                  <input
                    type="text"
                    value={(param.enum || []).join(', ')}
                    onChange={(e) =>
                      handleUpdateParameter(name, {
                        ...param,
                        enum: e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="e.g., high, medium, low"
                    className="mt-1 w-full rounded border border-gray-600 bg-gray-600 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Default value */}
              <div className="mt-2">
                <label className="block text-xs text-gray-400">
                  Default value (optional)
                </label>
                <input
                  type="text"
                  value={param.default !== undefined ? String(param.default) : ''}
                  onChange={(e) => {
                    let value: any = e.target.value;
                    if (param.type === 'number') {
                      value = value ? Number(value) : undefined;
                    } else if (param.type === 'boolean') {
                      value = value === 'true' ? true : value === 'false' ? false : undefined;
                    } else if (!value) {
                      value = undefined;
                    }
                    handleUpdateParameter(name, {
                      ...param,
                      default: value,
                    });
                  }}
                  placeholder="Leave empty for no default"
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-600 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Parameter Button */}
      <button
        onClick={() => setShowAddParam(!showAddParam)}
        className="mt-3 text-xs font-medium text-blue-400 hover:text-blue-300"
      >
        {showAddParam ? '✕ Cancel' : '+ Add Parameter'}
      </button>

      {/* Add Parameter Form */}
      {showAddParam && (
        <div className="mt-3 space-y-2 rounded border border-blue-700 bg-blue-900/20 p-2">
          <input
            type="text"
            value={newParamName}
            onChange={(e) => setNewParamName(e.target.value)}
            placeholder="Parameter name (e.g., amount)"
            className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />

          <select
            value={newParamType}
            onChange={(e) =>
              setNewParamType(e.target.value as CustomToolParameter['type'])
            }
            className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="object">object</option>
          </select>

          <button
            onClick={handleAddParameter}
            disabled={!newParamName.trim()}
            className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
          >
            Add Parameter
          </button>
        </div>
      )}
    </div>
  );
}
