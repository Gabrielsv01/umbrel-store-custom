import { useState } from 'react';
import type { CustomToolMethod, CustomToolParameter } from '../../types/customTools';
import ParameterEditor from './ParameterEditor';

interface MethodFormProps {
  method: CustomToolMethod;
  onChange: (method: CustomToolMethod) => void;
}

function validateJavaScriptCode(code: string, paramNames: string[]): string | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function(...paramNames, code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export default function MethodForm({ method, onChange }: MethodFormProps) {
  const [showCode, setShowCode] = useState(false);
  const codeError = validateJavaScriptCode(method.code, Object.keys(method.parameters || {}));

  const handleNameChange = (name: string) => {
    onChange({ ...method, name });
  };

  const handleDescriptionChange = (description: string) => {
    onChange({ ...method, description });
  };

  const handleCodeChange = (code: string) => {
    onChange({ ...method, code });
  };

  const handleParametersChange = (parameters: Record<string, CustomToolParameter>) => {
    onChange({ ...method, parameters });
  };

  return (
    <div className="space-y-4">
      {/* Name and Description */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-300">
            Method Name *
          </label>
          <input
            type="text"
            value={method.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g., greet_user"
            className="mt-1 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-0.5 text-xs text-gray-500">
            Use snake_case (e.g., calculate_tax)
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">
            Description *
          </label>
          <input
            type="text"
            value={method.description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="What does this method do?"
            className="mt-1 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Parameters */}
      <div>
        <label className="block text-xs font-medium text-gray-300">
          Parameters
        </label>
        <ParameterEditor
          parameters={method.parameters}
          onChange={handleParametersChange}
        />
      </div>

      {/* Code */}
      <div>
        <button
          onClick={() => setShowCode(!showCode)}
          className="flex items-center gap-2 text-xs font-medium text-blue-300 hover:text-blue-200"
        >
          {showCode ? '▼' : '▶'} Method Code
        </button>

        {showCode && (
          <div className="mt-2">
            <textarea
              value={method.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder={`Example: return JSON.stringify({ result: a + b });`}
              rows={6}
              className={`w-full rounded border px-2 py-1 font-mono text-xs text-white placeholder-gray-500 focus:outline-none ${
                codeError
                  ? 'border-red-500 bg-red-900/20 focus:border-red-500'
                  : 'border-gray-600 bg-gray-700 focus:border-blue-500'
              }`}
            />
            {codeError && (
              <div className="mt-2 rounded-lg border border-red-700 bg-red-900/30 p-3">
                <p className="text-xs font-medium text-red-300">⚠️ Code Error:</p>
                <p className="mt-1 font-mono text-xs text-red-200">{codeError}</p>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">
              💡 Write JavaScript code that returns a string. Access parameters
              directly: <code className="bg-gray-800 px-1">a</code>,
              <code className="bg-gray-800 px-1">b</code>, etc.
            </p>
            <details className="mt-2 text-xs text-gray-400">
              <summary className="cursor-pointer hover:text-gray-300">
                ℹ️ Code Examples
              </summary>
              <div className="mt-2 space-y-2 rounded bg-gray-800 p-2">
                <div>
                  <p className="font-mono text-gray-300">Simple return:</p>
                  <code className="block bg-gray-900 p-1 text-gray-400">
                    return JSON.stringify({'{result: a + b}'});
                  </code>
                </div>
                <div>
                  <p className="font-mono text-gray-300">With condition:</p>
                  <code className="block bg-gray-900 p-1 text-gray-400">
                    if (b === 0) return JSON.stringify({'{error: "Division by zero"}'});
                    <br />
                    return JSON.stringify({'{result: a / b}'});
                  </code>
                </div>
                <div>
                  <p className="font-mono text-gray-300">String manipulation:</p>
                  <code className="block bg-gray-900 p-1 text-gray-400">
                    const upper = text.toUpperCase();
                    <br />
                    return JSON.stringify({'{original: text, upper}'});
                  </code>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
