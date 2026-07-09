// Filtra a requisição pela query string. Config esperada (já normalizada):
// um mapa `{ <param>: string[] }`. Autoriza somente se, para CADA parâmetro
// configurado, o valor recebido estiver na lista de permitidos.
// (AND entre parâmetros, OR entre os valores de cada parâmetro.)
// Fail-closed: sem parâmetros configurados, nega a requisição.
export function queryParamsFilter(_payload: any, params: any, _headers: any, query: any): boolean {
    if (!params || typeof params !== 'object') {
        return false;
    }

    const entries = Object.entries(params as Record<string, string[]>);
    if (entries.length === 0) {
        return false;
    }

    const q = query || {};

    return entries.every(([param, allowedRaw]) => {
        const allowedValues = Array.isArray(allowedRaw) ? allowedRaw : [allowedRaw];
        const actual = q[param];
        const actualValues = Array.isArray(actual)
            ? actual
            : (actual !== undefined && actual !== null ? [actual] : []);

        return actualValues.some((value) => allowedValues.includes(String(value)));
    });
}
