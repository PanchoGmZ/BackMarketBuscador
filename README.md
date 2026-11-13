# BackMarketBuscadorJS

Actor de busqueda de Back Market mediante Node.js, Undici y Apify. Devuelve un registro con consulta, total y productos.

## HTML inspeccionado

La captura contiene `__NUXT_DATA__` y HTML renderizado suficiente, por lo que no se requiere decodificar Nuxt ni usar Chromium para esta muestra. El parser selecciona `[data-test="product-card"][data-qa="productCard"]`: se observaron 31 tarjetas en el listado. Las cinco tarjetas adicionales del cuadro de autocompletado se excluyen. Extrae el título y enlace de cada tarjeta, precio de `[data-qa="productCardPrice"] .heading-2`, indicador `Starting at`, imagen y, cuando aparecen, el ID y la categoría del contenedor. El precio anterior tachado no se usa. La moneda `USD` se asigna solo al símbolo `$` en un documento `lang="en-us"`. La condición no se observa en estas tarjetas y es `null`.

Se comprueba que el encabezado `Your search:` coincida con la consulta. Solo se admite `page: 1` en modo captura, porque no se ha verificado cómo recuperar la página de un HTML guardado. Si la estructura no coincide, hay una tarjeta sin título o enlace, o no hay tarjetas, se falla explícitamente; no se reconoce aún un estado vacío real. No hay garantía de que otros diseños, idiomas o categorías usen los mismos selectores. Enlaces cortos y con UUID se normalizan a absolutos, conservando parámetros y sin inferir IDs; la deduplicación usa la URL completa.

La fuente se entrega a `runSearch`, que escribe un solo registro `{ query, total, results }` en el Dataset. `total` es el número devuelto. `priceType: "starting_at"` indica que la tarjeta presenta el precio como inicial de una familia; no debe interpretarse como precio garantizado de una variante específica. Los campos ausentes son `null`.

## Input

El formulario publico de Apify solicita solamente la consulta:

```json
{ "query": "iphone 13" }
```

El limite predeterminado es 10 resultados y solo la pagina 1 esta verificada. Los campos anteriores `maxResults`, `page` y `diagnosticMode` siguen disponibles para clientes API; `page` distinta de 1 produce un error. El modo de diagnostico esta desactivado por defecto.

En Cloud se selecciona siempre Apify Proxy con el grupo UNBLOCKER. La configuracion de proxy de Inputs antiguos no sustituye ese grupo. Se requiere que la cuenta tenga acceso al servicio; un error de configuracion no activa una conexion directa alternativa. Se conservan las opciones TLS existentes del transporte con proxy.

## Ejecucion local y pruebas

Sin argumentos explicitos de Input, apify run lee storage/example/key_value_stores/default/INPUT.json. Cloud utiliza solo el Input de Apify.

`npm test` ejecuta las pruebas offline. La captura local `fixtures/iphone.html` se excluye de Git y Docker; algunas pruebas se omiten si falta. El modo `BACKMARKET_FIXTURE` solo se permite en local. Los resultados de capturas son historicos.

## Transporte, limites y diagnosticos

El Actor conserva el transporte Undici, el limite de 4 MiB, los timeouts HTTP de 45 segundos normales y 90 de diagnostico, y sus reglas de redireccion. No reintenta denegaciones ni guarda datos ficticios ante un desafio. Los registros `[TIEMPO_HTTP]` y `[RENDIMIENTO]` separan red, cuerpo, parsing y Dataset sin mostrar credenciales.

La configuracion actual de ProxyAgent usa `requestTls: { rejectUnauthorized: false }` para la conexion al destino a traves del proxy; no cambia TLS global. Esto desactiva la verificacion del certificado del destino en ese transporte y requiere revision independiente cuando se disponga de una cadena de certificados verificable.

## Preparacion de optimizacion

`node scripts/benchmark-buffers.js` compara offline el ensamblaje actual del cuerpo con una alternativa que evita copias intermedias y comprueba igualdad binaria. Necesita `fixtures/iphone.html` o una ruta de HTML guardado como argumento. Las mediciones de laboratorio no prueban mejora Cloud; el transporte de produccion no se ha modificado. Ver `docs/DIAGNOSTICO_RENDIMIENTO_BUSCADOR.md`.

## Dependencias y seguridad

El Input local versionado esta en storage/example/key_value_stores/default/INPUT.json. Docker excluye storage completo y el resto de los stores locales no se publica.

## Oxylabs local

En ejecuciones locales, el bootstrap carga .env.local con process.loadEnvFile de Node.js. Si hay usuario y password, usa Oxylabs; sin ambas credenciales, conserva el modo directo. El archivo .env.local queda excluido de Git y Docker.

La entrada local predeterminada es storage/example/key_value_stores/default/INPUT.json. Edita ese archivo y ejecuta apify run sin argumentos. El input.json de la raiz ya no se usa. Si el CLI entrega un Input explicito distinguible, ese Input mantiene prioridad. En Cloud se usa exclusivamente el Input de Apify.

El archivo de entorno normal es .env.local. Puede reutilizarse desde BackMarketJS con este comando PowerShell, que no sobrescribe un destino existente:

    Copy-Item -LiteralPath 'C:\Users\USUARIO\Desktop\backmarket-scraper-js\.env.local' -Destination 'C:\Users\USUARIO\Desktop\backmarket-buscador\.env.local' -NoClobber

Si no copias el archivo, crea .env.local con OXYLABS_USERNAME, OXYLABS_PASSWORD, OXYLABS_HOST=unblock.oxylabs.io y OXYLABS_PORT=60000. Configura la password solo localmente; puede contener el signo =. No guardes credenciales en el Input.

Los logs deben indicar [INPUT] Origen=storage/example/key_value_stores/default/INPUT.json y [PROXY] Tipo=oxylabs. El Dataset local queda en storage/datasets/default/. Para volver al modo directo, deja vacios usuario y password en .env.local o renombra el archivo.

Cloud sigue seleccionando UNBLOCKER y nunca carga .env.local ni el Input local. Oxylabs mantiene TLS verificada hacia el proxy y desactiva solo la verificacion del certificado del sitio, requerido por Web Unblocker segun https://oxylabs.io/resources/integrations/terminal.
