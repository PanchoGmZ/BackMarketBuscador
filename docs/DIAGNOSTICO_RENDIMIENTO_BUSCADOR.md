# Diagnostico de rendimiento del buscador

## Objetivo y estado

Esta instrumentacion permite medir; no demuestra una mejora de velocidad. No se han ejecutado solicitudes Cloud en esta tarea. El Dataset y su contrato conservan los mismos campos y estructura.

## Arquitectura y camino critico

`bootstrap.js` prepara la autenticacion local en memoria y carga `main.js`. El SDK inicializa el Actor y obtiene el Input. `runtime.js` configura el proxy si corresponde, `acquisition.js` solicita y lee el HTML con Undici, `parser.js` extrae las tarjetas, `search.js` normaliza y deduplica y el SDK escribe el Dataset. Finalmente se cierra el dispatcher y el Actor.

Cloud utiliza ProxyAgent y UNBLOCKER segun la configuracion; local conserva el flujo y la lectura de Input existentes. Hay una solicitud principal sin reintentos. Las redirecciones directas autorizadas pueden agregar solicitudes, con limites y presupuesto existentes. HTTP 403/429 y desafios no se reintentan.

## Instrumentacion

Todos los intervalos usan `performance.now()` y estan en milisegundos:

- `[ACTOR_INICIALIZACION]`: `initializationMs` mide Actor.init; `processElapsedMs` es tiempo transcurrido de Node hasta el log e incluye importaciones previas.
- `[TIEMPO_HTTP]`: `requestStartMs` es el desplazamiento desde el inicio del adquiridor a la primera llamada; `requests` cuenta solicitudes; `headersMs` mide hasta los ultimos encabezados observados desde el inicio, incluidas redirecciones; `bodyReadMs` mide la lectura del cuerpo final; `htmlBytes` cuenta bytes del flujo descomprimido recibido; `elapsedMs` incluye validaciones y decodificacion.
- `[RENDIMIENTO]`: `proxySetupMs`, `acquisitionMs`, `parsingMs`, `cardsParsed`, `deduplicationMs`, `datasetMs`, `dispatcherCloseMs` y `runtimeMs`. La deduplicacion incluye la normalizacion de candidatos y puede detenerse al llegar a maxResults; cardsParsed cuenta las tarjetas que el parser produjo antes de deduplicar.
- `[ACTOR_SALIDA]`: `processElapsedBeforeExitMs` mide desde el inicio de Node hasta justo antes de Actor.exit o Actor.fail. `[ACTOR_DURACION]` registra `processElapsedMs` en el evento de salida de Node, incluyendo el cierre interno normal del SDK. El log de salida puede perderse ante terminacion forzada; el tiempo de Apify incluye ademas preparacion y cierre de la plataforma.

`null` indica que una fase no se ejecuto o no termino; no equivale a cero. Las fases pueden solaparse y los tiempos incluidos no deben sumarse indiscriminadamente. El HTML fixture evita HTTP/proxy. No se registran consultas, cuerpos, credenciales ni tokens adicionales.

## Cuellos de botella posibles

El intervalo hasta encabezados comprende red, proxy y servidor, sin atribucion interna. La lectura depende de tamano y velocidad. Cheerio carga el documento y procesa todas las tarjetas; su costo depende del HTML. La deduplicacion y Dataset son fases separadas. Un limite de tiempo es un maximo, no una espera fija. La configuracion del proxy y el cierre del dispatcher merecen medicion independiente.

## Aprendizajes de BackMarketJS

Es transferible instrumentar por etapas, reutilizar el HTML ya recibido, respetar limites y validar salida. El buscador ya usa una solicitud HTTP y parsea su cuerpo: no hay evidencia de una descarga duplicada que eliminar.

No se trasladan directamente el arranque de Firefox, `domcontentloaded`, captura de respuesta de Playwright ni bloqueo de recursos. El buscador procesa tarjetas y el extractor de fichas usa estado Nuxt. Cambiar a Firefox o modificar TLS y proxy implicaria riesgos y no se justifica con las mediciones de otro Actor.

## Recomendaciones priorizadas

1. **Alta; beneficio medible; riesgo bajo; esfuerzo bajo:** recoger multiples logs por consulta y separar proxy, encabezados, cuerpo, parsing, Dataset y cierre. Anotar tamano HTML y cantidad de tarjetas.
2. **Media; beneficio incierto; riesgo medio; esfuerzo medio:** perfilar concatenacion de chunks y Cheerio con fixtures reales de diferentes tamanos. Optimizar solo si representan una fraccion relevante, manteniendo Unicode, limite de 4 MiB y mismo Dataset.
3. **Baja; beneficio incierto; riesgo alto; esfuerzo alto:** cambiar transporte, concurrencia o autenticacion. Requiere validacion comercial y de red independiente; no es necesario para la instrumentacion.

## Plan de medicion Cloud

Usar un build identificado, el mismo Input y proxy, y obtener varias ejecuciones autorizadas de consultas representativas. Registrar las metricas anteriores, el tiempo total de Apify, estado y cantidad de resultados; comparar distribuciones, no un unico run. Confirmar identidad, orden y precios del Dataset antes/despues. No registrar tokens, cookies ni HTML privado. No atribuir tiempos a un proveedor concreto sin mediciones adicionales.

## Validacion local

`npm ci`, `npm test` y `apify validate-schema` comprueban instalacion, pruebas y esquemas. Los tests usan HTML real guardado cuando existe y transporte/proxy simulado; no sustituyen la comparacion Cloud. No se realizaron solicitudes pagadas en esta tarea.
