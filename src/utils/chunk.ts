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
 * El proxy de produccion responde 414 cuando la linea de peticion pasa de unos 8 190
 * caracteres, y sin cabeceras CORS el navegador solo informa "Failed to fetch". Cada UUID
 * codificado ocupa 39 caracteres, asi que 200 identificadores rozaban el limite; con 100
 * la URL queda en unos 4 KB y deja margen para el resto de la consulta.
 */
export const ID_FILTER_CHUNK_SIZE = 100;
