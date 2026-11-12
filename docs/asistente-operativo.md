# Asistente MesaPro — primera etapa

El asistente está disponible con el botón **Asistente** en las pantallas autenticadas. Esta versión integra Gemini con consultas autorizadas a la base de datos y conserva los procedimientos guiados como respaldo. No requiere migraciones. Deben actualizarse tanto el backend como el frontend. La clave permanece únicamente en el backend.

## Configuración de Gemini

Instalar las dependencias del backend con `npm install` y configurar su `.env` (excluido de Git):

```dotenv
GEMINI_API_KEY=tu_clave_privada
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_ENABLED=true
```

`GEMINI_MODEL` y `GEMINI_ENABLED` son opcionales: los valores por defecto son los mostrados. `GEMINI_ENABLED=false` mantiene el modo básico. El servidor solo admite `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` y `gemini-2.5-flash-lite`; no cambia a otros modelos automáticamente. Son candidatos documentados con capa gratuita, pero la disponibilidad y cuotas dependen del proyecto de Google. Esta integración no habilita facturación ni cambia el nivel del proyecto; comprueba en AI Studio que tu proyecto permanezca en Free.

Reiniciar el backend después de cambiar variables. En hosting, configurarlas como secretos del servicio del backend; nunca como variables `VITE_*`. El SDK oficial es `@google/genai`.

El chat muestra **Gemini** cuando responde con IA y **Modo básico** con un aviso cuando hay límites, configuración ausente, errores o conexión fallida. Se conservan los botones de navegación. El respaldo reconoce frases guiadas; no tiene todas las búsquedas flexibles de la IA.

Cada turno hace como máximo tres llamadas al modelo y ejecuta hasta cuatro herramientas. El límite local es de doce llamadas al modelo por minuto por proceso de backend, una consulta simultánea por sesión y dos sesiones simultáneas. No representa la cuota garantizada por Google. Un error 429 activa un enfriamiento de sesenta segundos sin reintentos automáticos. No se habilitan búsqueda web, mapas ni herramientas externas facturables. Las llamadas tienen tiempos máximos y no se registran claves, encabezados ni errores completos del SDK.

Los datos necesarios de pedidos y los últimos mensajes se envían a Google. Para pruebas universitarias utiliza datos ficticios: la capa gratuita está sujeta a las condiciones de tratamiento de datos del proveedor. Referencias: [SDK](https://ai.google.dev/gemini-api/docs/libraries), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [precios](https://ai.google.dev/gemini-api/docs/pricing) y [cuotas](https://ai.google.dev/gemini-api/docs/rate-limits).

## Funciones

- Explicar el flujo para llevar, mesas, efectivo, cantidades e impresión.
- Buscar un pedido por código de retiro, UUID completo o nombre del cliente. Si el código coincide con varios pedidos, permite elegir uno.
- Mostrar productos, estado, pago confirmado, saldo y siguiente paso. Los montos sin cuenta generada se identifican como estimados.
- Listar pedidos pendientes de entrega de la sucursal, mostrando como máximo diez.
- Utilizar el pedido abierto como contexto para preguntas sobre “este pedido”. Después de una búsqueda también permite consultar ese pedido mientras no se seleccione otro.
- Navegar al pedido o a su sección de cuenta y pago para cobrar o reimprimir. Los botones del chat no cobran ni imprimen directamente.
- Sugerir preguntas según la pantalla, el rol y el pedido seleccionado.
- Con Gemini: combinar cliente, tipo, pago, entrega y fecha de creación; interpretar seguimientos como “el de Juan” o “el de hoy”. Las fechas respetan la zona horaria del local, incluidos los cambios de hora.
- Diagnosticar pagos pendientes de confirmación y estaciones inválidas antes del cobro. Los datos actuales se consultan en cada turno.

Ejemplos:

- “¿Cómo hago una venta para llevar?”
- “Busca el pedido ABC123” o simplemente “ABC123”.
- “Busca pedidos del cliente José”.
- “¿Qué pedidos tengo pendientes de entrega?”
- “¿Qué falta para completar este pedido?”
- “¿Por qué no puedo imprimir este pedido?”
- “¿Cómo reimprimo el vale de este pedido?”

## Permisos y datos

`POST /assistant/messages` usa `ScopedJwtAuthGuard`, valida el local activo y el negocio, y vuelve a verificar el alcance en el servicio. OWNER y ADMIN pueden seleccionar locales de su negocio; los demás roles solo su local asignado. WAITER solo consulta pedidos asignados a su usuario. KITCHEN no tiene acceso al asistente operativo. Los reportes se ofrecen únicamente a OWNER, ADMIN y MANAGER mediante navegación a la pantalla existente.

El endpoint acepta `message` (1–500 caracteres), `locationId` (UUID), `orderId` opcional (UUID) y `page` opcional (ruta de la aplicación), además de `history` opcional con hasta ocho mensajes de tipo user/assistant y 2500 caracteres por mensaje. Devuelve texto, enlaces internos, preguntas sugeridas, el origen (`manual` o `live`) y la hora de consulta, además de `mode` (gemini/basic) y `notice` cuando se utiliza el respaldo. La búsqueda por código usa SQL parametrizado con filtros de negocio, sucursal y mesero; no interpola instrucciones del usuario como SQL.

La conversación se conserva solo en memoria durante la sesión de la pantalla general. Se borra al cambiar de usuario, membresía, rol o sucursal; también se puede limpiar manualmente. El historial se envía a Gemini como contexto no confiable; no concede permisos ni acredita pagos. Cada consulta solicita datos actuales. Los mensajes anteriores muestran la hora de consulta y no se actualizan automáticamente.

## Mantenimiento y validación

Los procedimientos y las herramientas autorizadas están en `src/modules/assistant/assistant.service.ts`; el cliente, instrucciones y límites de Gemini están en `gemini-assistant.service.ts`. El modelo nunca elige negocio, usuario ni sucursal, ni ejecuta SQL o escrituras. Los argumentos se validan contra DTOs y los botones se construyen en el servidor. Al cambiar un flujo de MesaPro, actualizar su guía y sus pruebas. Las frases fuera del alcance reciben una explicación de las funciones disponibles, sin inventar respuestas.

Desde el backend:

```powershell
npm run build
node --test test/assistant.test.mjs test/gemini-assistant.test.mjs test/takeaway-flow.test.mjs
```

Desde el frontend:

```powershell
npm run build
npx eslint src/modules/assistant/AssistantWidget.tsx src/modules/assistant/AssistantProvider.tsx src/modules/assistant/assistantContext.ts src/modules/assistant/assistant.api.ts
```

Para una comprobación manual, iniciar sesión como cajero, abrir el chat, consultar la guía, buscar un pedido y usar **Ir al cobro**. Como mesero, comprobar que las búsquedas solo muestran sus pedidos. Cambiar de sucursal y verificar que la conversación se vacía. La reimpresión se confirma desde los controles existentes del pedido.


Pruebas opcionales con conexión real (consumen cuota de Gemini):

```powershell
node scripts/check-gemini.mjs
node scripts/check-gemini.mjs --assistant-demo
```

La segunda prueba utiliza exclusivamente pedidos ficticios sin conectarse a la base real. Verifica una conversación de tres turnos: listar pedidos pagados pendientes, elegir al cliente Juan y consultar qué falta para completarlo. Nunca imprime la clave ni detalles completos de errores del proveedor.
