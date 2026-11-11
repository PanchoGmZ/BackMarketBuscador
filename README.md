# BackMarketBuscadorJS

El Actor conecta una búsqueda HTTP live al parser y al Dataset. **El acceso y la extracción live no están verificados.** La captura manual `fixtures/iphone.html` se usa solo para desarrollo local; sus precios son históricos, no ofertas actuales.

## HTML inspeccionado

La captura contiene `__NUXT_DATA__` y HTML renderizado suficiente, por lo que no se requiere decodificar Nuxt ni usar Chromium para esta muestra. El parser selecciona `[data-test="product-card"][data-qa="productCard"]`: se observaron 31 tarjetas en el listado. Las cinco tarjetas adicionales del cuadro de autocompletado se excluyen. Extrae el título y enlace de cada tarjeta, precio de `[data-qa="productCardPrice"] .heading-2`, indicador `Starting at`, imagen y, cuando aparecen, el ID y la categoría del contenedor. El precio anterior tachado no se usa. La moneda `USD` se asigna solo al símbolo `$` en un documento `lang="en-us"`. La condición no se observa en estas tarjetas y es `null`.

Se comprueba que el encabezado `Your search:` coincida con la consulta. Solo se admite `page: 1` en modo captura, porque no se ha verificado cómo recuperar la página de un HTML guardado. Si la estructura no coincide, hay una tarjeta sin título o enlace, o no hay tarjetas, se falla explícitamente; no se reconoce aún un estado vacío real. No hay garantía de que otros diseños, idiomas o categorías usen los mismos selectores. Enlaces cortos y con UUID se normalizan a absolutos, conservando parámetros y sin inferir IDs; la deduplicación usa la URL completa.

La fuente se entrega a `runSearch`, que escribe un solo registro `{ query, total, results }` en el Dataset. `total` es el número devuelto. `priceType: "starting_at"` indica que la tarjeta presenta el precio como inicial de una familia; no debe interpretarse como precio garantizado de una variante específica. Los campos ausentes son `null`.

## F5 y pruebas

Instala Node.js 20 o posterior y ejecuta `npm install`. Coloca la captura en `fixtures/iphone.html`, y crea `storage/key_value_stores/default/INPUT.json` con `{"query":"iPhone 15 Pro","maxResults":10,"page":1}`. En VS Code pulsa F5 con **Actor local**: esta configuración establece `BACKMARKET_FIXTURE=iphone.html`. El Dataset se encuentra en `storage/datasets/default/`. Usa un almacenamiento vacío para separar ejecuciones.

`npm test` ejecuta las pruebas, incluida la captura real y una ejecución del SDK con almacenamiento temporal local. Para elegir otra captura local desde PowerShell, establece `$env:BACKMARKET_FIXTURE='nombre.html'` y ejecuta `npm start`; el archivo debe estar en `fixtures/`. Las capturas se excluyen de Git y Docker porque pueden contener datos de la sesión de navegación; deben suministrarse por separado para reproducir las pruebas. No se conectan proxies ni se realizan solicitudes en este modo.

## Adquisición y Cloud

El [robots.txt de Back Market](https://www.backmarket.com/robots.txt) restringe `*/search` a rastreadores. Esto es independiente de procesar una captura proporcionada manualmente. El modo predeterminado live hace una solicitud directa HTTP a la búsqueda nativa y nunca usa la captura como alternativa. `BACKMARKET_FIXTURE` selecciona explícitamente un archivo local; este modo se rechaza en Apify Cloud.

Una comprobación directa el 9 de noviembre de 2026 recibió primero HTTP 301 sin seguir la redirección y, en una segunda solicitud para inspeccionarla, HTTP 403. El acceso quedó detenido tras la denegación. No se utilizó UNBLOCKER ni otro proxy para superarla. `diagnosticMode` muestra tiempos adicionales. `proxyConfiguration` opcional se pasa al SDK oficial de Apify; usa únicamente un proxy autorizado y no para eludir denegaciones.

`src/acquisition.js` usa un transporte HTTP con URL nativa, límite de tiempo y tamaño, sin reintentos y sin seguir redirecciones. Clasifica 401/403, 429, desafíos visibles conocidos, respuestas vacías, contenido inesperado y fallos de red. Sus pruebas inyectan un transporte simulado: **no se ha comprobado la extracción en vivo**, y la detección de desafíos no garantiza reconocer todas sus variantes. La página 2 no está implementada ni verificada.

El registro `[PROXY]` muestra el tipo, el protocolo y si hay credenciales, sin revelar la URL. Ante un fallo de conexión, `[DIAGNOSTICO_CONEXION]` muestra etapa, duración, códigos conocidos y, si Undici lo informa, el estado de CONNECT. `PROXY_AUTH_ERROR` indica CONNECT 407; `TLS_ERROR`, `DNS_ERROR`, `TCP_ERROR`, `TIMEOUT` y `UNDICI_ERROR` distinguen otros fallos conocidos. Un fallo TLS puede corresponder al proxy o al destino: no se afirma cuál sin evidencia. La verificación TLS permanece activada. Los mensajes, direcciones y credenciales de errores anidados nunca se registran; sus causas se conservan internamente. Un `NETWORK_ERROR` sin código conocido requiere información adicional.

El timeout anterior era el temporizador local `setTimeout` en `createHttpAcquirer`, cuyo valor predeterminado estaba fijado a `15000` ms. Ese `AbortController` abortaba la petición Undici tanto mientras esperaba las cabeceras como durante el cuerpo; los logs con `elapsedMs≈15002`, `stage=request_before_headers` y sin códigos confirman que fue este límite local. El presupesto de Apify Cloud no es la causa indicada por ese diagnóstico.

El nuevo presupuesto HTTP predeterminado es 45 s en modo normal y 90 s con `diagnosticMode`. Las variables de entorno `BACKMARKET_HTTP_TIMEOUT_MS` y `BACKMARKET_DIAGNOSTIC_HTTP_TIMEOUT_MS` permiten reducir esos valores; el código rechaza valores superiores a los límites. `AbortController.signal` se pasa a Undici, por lo que el presupuesto cancelará la solicitud o lectura del cuerpo. `[TIEMPO_HTTP]` registra el presupuesto, tiempo real y origen local del timeout. `[LIMITES]` informa HTTP y margen final de 30 s para parsing, Dataset y cierre. Configura el timeout total del Run de Apify en al menos **75 s normal o 120 s diagnóstico**; el límite total lo aplica la plataforma al Run, no un timeout global de Node.

**Excepción temporal de TLS:** con un proxy configurado, Undici `ProxyAgent` recibe `requestTls: { rejectUnauthorized: false }`. Solo afecta al certificado TLS de la conexión con el destino a través del túnel; no cambia `proxyTls` ni la configuración TLS global de Node. El Actor registra `[TLS] {"verified":false}` y `[URL]` con el parámetro de búsqueda redactado. Desactiva la verificación del certificado del destino y es inseguro para producción; retíralo cuando se corrija la cadena de certificados que causó `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Las pruebas offline incluyen un proxy HTTP local con CONNECT y autenticación Basic y una respuesta local CONNECT 407; no comprueban el proxy ni los certificados de Apify Cloud. El log original de Cloud no incluye la causa anidada, así que no permite determinar el origen exacto del error observado. Comparte solamente los códigos y etapas de `[DIAGNOSTICO_CONEXION]` de tu próxima prueba para analizarla.

Antes de una prueba live hay que confirmar que el acceso automatizado esté autorizado bajo las condiciones aplicables. El HTML guardado no prueba que HTTP entregue resultados sin renderizado. Si hay redirección, denegación o desafío, la ejecución falla explícitamente. Una búsqueda sin tarjetas tampoco se presenta como vacía, porque no se ha observado una respuesta vacía real.

Para probar manualmente en Apify, crea un Actor independiente con fuente GitHub, conecta `https://github.com/PanchoGmZ/BackMarketBuscador.git` en la rama `main`, construye la versión y proporciona `{"query":"iPhone 15 Pro","maxResults":10,"page":1,"diagnosticMode":true}`. Deja el proxy sin seleccionar para probar una conexión directa; configúralo solo si su uso está autorizado. Consulta la pestaña Logs y el Dataset en Output. Un 301, 403, 429, desafío o HTML incompatible producirá un error, no datos ficticios. El proyecto no se ha probado en Cloud.

## Conexion local mediante VPN del sistema

Cloud conserva el transporte UNBLOCKER, autenticacion, TLS y tratamiento de redirecciones anteriores. Si se omite `proxyConfiguration`, se utiliza Apify Proxy con grupo UNBLOCKER. El Input Cloud existente no cambia.

Para conexion directa, usar `proxyConfiguration: { "useApifyProxy": false }` (sin `proxyUrls`). Este modo no llama a `Actor.createProxyConfiguration`, no construye ProxyAgent y no requiere login de Apify. La VPN se administra fuera de esta aplicacion. Los proxies personalizados explicitamente configurados conservan el transporte anterior.

Solo en modo directo se siguen hasta cinco redirecciones GET 301/302/303/307/308. Los destinos permitidos son HTTPS en `www.backmarket.com` o `backmarket.com`, puerto estandar, rutas `/en-us/search` y `/en-us/search/`, sin credenciales. Se resuelve Location relativo o absoluto; se conservan sus parametros y se recupera `q` de la URL anterior si Location lo omite. Bucles, Location ausente, destinos inesperados y exceso de saltos producen errores explicitos. No se reintentan solicitudes fallidas. Todos los saltos y lectura del cuerpo comparten el mismo AbortSignal y presupuesto de 45/90 segundos; los cuerpos de redireccion se cancelan. Se registra cada HTTP y URL final con valores de parametros ocultos.

Prueba real local del 11 de noviembre de 2026: Windows/Node 24 recibio HTTP 301 hacia `https://www.backmarket.com/testchallengepage`. Se clasifica como `ACCESS_CHALLENGE` y no se sigue. No se obtuvieron productos nuevos ni se puede afirmar que la conexion VPN disponible permita la busqueda. No se intento superar el desafio. Cloud no se ejecuto; su funcionamiento previo es el confirmado por el usuario.

Desde PowerShell, con la VPN conectada:

```powershell
Set-Location C:\Users\USUARIO\Desktop\backmarket-buscador
npm ci
Remove-Item Env:BACKMARKET_FIXTURE -ErrorAction SilentlyContinue
apify run --input-file .\input-vpn.json
```

`input-vpn.json` contiene la consulta `iphone 13` y desactiva Apify Proxy. El CLI puede avisar que no hay login; este modo no lo necesita. Una ejecucion exitosa escribe un unico registro en `storage/datasets/default/000000001.json`. Ante un desafio/error no se escribe un resultado comercial. El CLI limpia los almacenes locales al iniciar por defecto. No hay fallback a fixtures.
