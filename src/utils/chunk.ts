/**
 * Divide una lista en bloques de tamano fijo.
 *
 * Se usa para acotar el numero de identificadores que viaja en una sola consulta.
 * PostgREST expresa los filtros `in` en la URL, de modo que una lista larga de UUID
 * puede superar el limite de longitud que aceptan los servidores intermedios y hacer
 * fallar la peticion entera.
 */
export const chunkArray = <T,>(items: T[], size: number): T[][] => {
    if (size <= 0) return items.length > 0 ? [items] : [];

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

/**
 * Tamano de bloque para filtros por identificador.
 *
 * Con UUID de 36 caracteres, 200 identificadores ocupan unos 7,5 KB de URL, por debajo
 * del limite habitual de 8 a 16 KB de nginx y similares.
 */
export const ID_FILTER_CHUNK_SIZE = 200;
