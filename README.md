# BackMarketBuscadorJS

El parser funciona con la captura manual `fixtures/iphone.html`. La adquisición en vivo está **pendiente**; sin la variable de captura el Actor termina con `SOURCE_UNAVAILABLE` y no inventa resultados. Los precios de la captura son históricos, no ofertas actuales.

## HTML inspeccionado

La captura contiene `__NUXT_DATA__` y HTML renderizado suficiente, por lo que no se requiere decodificar Nuxt ni usar Chromium para esta muestra. El parser selecciona `[data-test="product-card"][data-qa="productCard"]`: se observaron 31 tarjetas en el listado. Las cinco tarjetas adicionales del cuadro de autocompletado se excluyen. Extrae el título y enlace de cada tarjeta, precio de `[data-qa="productCardPrice"] .heading-2`, indicador `Starting at`, imagen y, cuando aparecen, el ID y la categoría del contenedor. El precio anterior tachado no se usa. La moneda `USD` se asigna solo al símbolo `$` en un documento `lang="en-us"`. La condición no se observa en estas tarjetas y es `null`.

Se comprueba que el encabezado `Your search:` coincida con la consulta. Solo se admite `page: 1` en modo captura, porque no se ha verificado cómo recuperar la página de un HTML guardado. Si la estructura no coincide, hay una tarjeta sin título o enlace, o no hay tarjetas, se falla explícitamente; no se reconoce aún un estado vacío real. No hay garantía de que otros diseños, idiomas o categorías usen los mismos selectores. Enlaces cortos y con UUID se normalizan a absolutos, conservando parámetros y sin inferir IDs; la deduplicación usa la URL completa.

La fuente se entrega a `runSearch`, que escribe un solo registro `{ query, total, results }` en el Dataset. `total` es el número devuelto. `priceType: "starting_at"` indica que la tarjeta presenta el precio como inicial de una familia; no debe interpretarse como precio garantizado de una variante específica. Los campos ausentes son `null`.

## F5 y pruebas

Instala Node.js 20 o posterior y ejecuta `npm install`. Coloca la captura en `fixtures/iphone.html`, y crea `storage/key_value_stores/default/INPUT.json` con `{"query":"iPhone 15 Pro","maxResults":10,"page":1}`. En VS Code pulsa F5 con **Actor local**: esta configuración establece `BACKMARKET_FIXTURE=iphone.html`. El Dataset se encuentra en `storage/datasets/default/`. Usa un almacenamiento vacío para separar ejecuciones.

`npm test` ejecuta las pruebas, incluida la captura real y una ejecución del SDK con almacenamiento temporal local. Para elegir otra captura local desde PowerShell, establece `$env:BACKMARKET_FIXTURE='nombre.html'` y ejecuta `npm start`; el archivo debe estar en `fixtures/`. Las capturas se excluyen de Git y Docker porque pueden contener datos de la sesión de navegación; deben suministrarse por separado para reproducir las pruebas. No se conectan proxies ni se realizan solicitudes en este modo.

## Adquisición y Cloud

El [robots.txt de Back Market](https://www.backmarket.com/robots.txt) restringe `*/search` a rastreadores. Esto es independiente de procesar una captura proporcionada manualmente. El modo live permanece deshabilitado: sin `BACKMARKET_FIXTURE` termina en `SOURCE_UNAVAILABLE`, sin solicitudes ni fallback a capturas. Con la variable definida se utiliza exclusivamente el archivo indicado y se registra `Modo fixture`.

Una comprobación directa el 9 de noviembre de 2026 recibió primero HTTP 301 sin seguir la redirección y, en una segunda solicitud para inspeccionarla, HTTP 403. El acceso quedó detenido tras la denegación. No se utilizó UNBLOCKER ni otro proxy para superarla. `diagnosticMode` muestra tiempos de procesamiento local; `proxyConfiguration` está reservado y no se utiliza en esta versión.

`src/acquisition.js` prepara un transporte HTTP independiente con URL nativa, límite de tiempo y tamaño, sin reintentos y sin seguir redirecciones. Clasifica 401/403, 429, desafíos visibles conocidos, respuestas vacías, contenido inesperado y fallos de red. Sus pruebas inyectan un transporte simulado: **no se ha comprobado la solicitud en vivo**, y la detección de desafíos no garantiza reconocer todas sus variantes. La página 2 no está implementada ni verificada.

Para habilitarlo hay que verificar que el acceso automatizado esté autorizado bajo las condiciones aplicables, conectar explícitamente un transporte permitido al Actor y comprobar respuestas reales, identidad de página, paginación y errores sin eludir desafíos o denegaciones. El HTML guardado no prueba que HTTP entregue resultados sin renderizado. Una vez resuelto y verificado, se podrá utilizar `apify push` o conectar un repositorio independiente conforme a la [documentación de Apify](https://docs.apify.com/actors/development/quick-start/locally). No se ha publicado ni probado en Cloud.
