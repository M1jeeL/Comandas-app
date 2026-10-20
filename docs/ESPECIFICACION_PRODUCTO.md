# Mesa Pro — Especificación de producto y dominio

**Versión:** 0.15.0
**Estado:** línea base actualizada; las reglas MVP decididas se detallan en las secciones 4 y 9
**Actualizado:** 2026-10-19
**Autoridad:** este documento es la referencia funcional para planificar y revisar cambios. Si el código contradice una regla aquí aprobada, se registra la diferencia y se corrige el código; no se cambia la regla de forma implícita.

## 1. Propósito y alcance

Mesa Pro es una plataforma SaaS para la operación diaria de restaurantes. El producto cubre operación de mesas y pedidos, impresión física de comandas, cobro y control básico del negocio. El personal de cocina trabaja con papel y no necesita interactuar con el sistema.

La arquitectura debe admitir varios negocios y varios locales por negocio, manteniendo un MVP sencillo de operar. Los datos operacionales pertenecen a un local. El MVP prioriza flujos correctos y trazables sobre amplitud de funciones.

Este documento reúne:

- reglas de dominio acordadas en la visión inicial;
- observaciones del código actual;
- objetivo funcional del MVP;
- brechas y decisiones aún no cerradas.

“Existe” significa que se encontró implementación en el repositorio, no que se haya verificado su comportamiento en ejecución. No se ejecutaron pruebas para esta revisión.

## 2. Principios de producto

1. **Multi-tenant desde el diseño:** `Business` agrupa locales; cada dato operacional debe quedar ligado a un `Location`.
2. **El servidor es autoridad:** el backend valida permisos, transiciones y montos definitivos. El frontend puede presentar estimaciones.
3. **Historial preservado:** se desactivan entidades de catálogo en vez de borrar información necesaria para pedidos y reportes históricos.
4. **Trazabilidad de negocio:** cancelaciones, modificaciones, transferencias y movimientos financieros conservan actor, momento y motivo cuando aplique.
5. **Dominio antes que CRUD:** las operaciones sensibles se expresan como acciones válidas del negocio y no como cambios arbitrarios de campos.
6. **Monolito modular pragmático:** NestJS con límites por módulo y responsabilidades claras. Usar Domain/Application/Infrastructure donde proteja reglas reales; evitar interfaces y capas ceremoniales.
7. **MVP enfocado:** extensiones futuras no deben imponer su complejidad al flujo actual.

## 3. Términos y entidades principales

| Término             | Significado                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Business`          | Negocio/empresa cliente de Mesa Pro. Puede tener varios locales.                                                   |
| `Location`          | Local del negocio. Unidad de aislamiento de la operación.                                                          |
| `User`              | Persona con credenciales de acceso.                                                                                |
| `Membership`        | Relación de un usuario con un negocio, con rol y estado.                                                           |
| `Workstation`       | Estación de preparación, por ejemplo Cocina, Bar o Parrilla.                                                       |
| `Device`            | Dispositivo de operación asociado a una estación. **Aún no aparece en el esquema actual.**                         |
| `RestaurantTable`   | Mesa física del local. No representa una cuenta ni una ocupación.                                                  |
| `TableSession`      | Ocupación temporal de una mesa, con mesero responsable y pedidos asociados.                                        |
| `Order`             | Pedido de cliente, con tipo, estado e ítems.                                                                       |
| Comanda impresa | Representación física de los productos nuevos del pedido, agrupados por estación. No requiere interacción de cocina con el sistema. |
| `Bill`              | Cuenta/cobro que agrupa uno o más pedidos y contiene descuentos, propina y pagos.                                  |
| `Payment`           | Pago registrado con método, monto y estado. Puede ser parcial.                                                     |
| `CashMovement`      | Entrada o salida de dinero de caja; no equivale necesariamente a un pago.                                          |
| `CashSession`       | Apertura y cierre de una caja, con monto esperado y monto contado.                                                 |
| `AuditLog`          | Registro transversal de acciones relevantes para seguridad, dinero y operación. No sustituye entidades de dominio. |

## 4. Reglas de dominio

### 4.1 Tenencia, identidad y permisos

- Un negocio contiene uno o más locales.
- La operación pertenece a un local: mesas, catálogo, pedidos, comandas impresas, cuentas y caja.
- Una persona accede mediante una membresía activa y un rol.
- Cada membresía tiene una sucursal asignada. `OWNER` y `ADMIN` pueden operar en todos los locales de su negocio; `MANAGER`, `WAITER` y `CASHIER` quedan limitados al local de su membresía. `KITCHEN` se conserva solo como rol histórico y no tiene acceso operativo en el MVP.
- `OWNER` administra el negocio y sus roles operativos, excepto que `KITCHEN` queda deshabilitado para nuevas asignaciones. `ADMIN` administra el negocio y roles operativos, pero no puede asignar `OWNER` ni administrar otro `ADMIN`.
- `MANAGER` administra la operación de su local, puede gestionar personal operativo de ese local (`WAITER`, `CASHIER`) y no puede mover personas a otro local, administrar otros `MANAGER` ni realizar tareas exclusivas de propietario/administrador.
- `WAITER` solo puede abrir mesas libres a su nombre y operar sesiones/pedidos asignados a su usuario; puede consultar/solicitar cuentas y registrar, confirmar o cancelar pagos únicamente cuando todos los pedidos de la cuenta están asignados a su usuario. No puede rechazar pagos ni administrar descuentos/anulaciones. La recepción de efectivo en caja sigue bajo control de `CASHIER` o administración.
- `CASHIER` gestiona cobros, pagos y caja de su local, además de las lecturas operativas necesarias para atender pedidos.
- El personal de cocina no necesita cuentas ni interacción con el sistema. El rol heredado `KITCHEN` no dispone de módulos operativos; las comandas se entregan en papel.
- El backend deriva negocio, usuario, rol y local desde la membresía activa. En cada endpoint valida el local explícito o resuelve el local del recurso por su relación. Un `locationId` enviado por el cliente nunca prueba autorización.
- El frontend oculta módulos y protege sus rutas según rol para orientar la navegación. Esto no sustituye la autorización backend: cada endpoint sigue aplicando permisos y aislamiento sobre el recurso concreto.
- `POST /auth/login`, `POST /auth/register` y `POST /auth/refresh` validan el origen confiable y tienen límites de solicitudes: login (5 por 15 minutos por IP y cuenta), registro (3 por hora por IP) y refresh (30 por minuto por IP). La implementación actual usa memoria del proceso; una instalación con varias instancias debe usar un almacén compartido para que el límite sea efectivo globalmente.
- El registro público normaliza el correo y exige contraseña de al menos 12 caracteres. Los errores de acceso se presentan con mensajes comprensibles sin revelar si una cuenta existe al fallar las credenciales.
- Los dispositivos se asocian a una estación y la persona inicia sesión desde el dispositivo. **Este flujo es objetivo, no está modelado aún.**

### 4.2 Mesas y sesiones

- La mesa es infraestructura física; su estado operacional no se deduce solo de la sesión.
- `ACTIVE`/`INACTIVE` controla habilitación administrativa. El estado operacional persistido es `AVAILABLE`, `RESERVED` o `OUT_OF_SERVICE`; `OCCUPIED` se deriva de una sesión `OPEN`/`CLOSING` para evitar dos fuentes de verdad.
- Solo `OWNER`, `ADMIN` o `MANAGER` puede cambiar la disponibilidad operacional, y solo sin sesión activa. Una mesa `RESERVED` o `OUT_OF_SERVICE` no puede abrirse en la operación normal; para atenderla, administración debe dejarla `AVAILABLE`. `RESERVED` es un bloqueo manual, sin calendario ni entidad de reserva en el MVP.
- Estados de `TableSession`: `OPEN`, `CLOSING`, `CLOSED`, `CANCELLED`.
- Una mesa no puede tener más de una sesión activa a la vez.
- Una sesión cerrada o cancelada no acepta pedidos.
- La apertura asigna un mesero responsable. Un `WAITER` solo puede abrir mesas libres asignándoselas a sí mismo, consultar/cerrar sus propias sesiones y operar sus pedidos; el backend rechaza cualquier intento sobre una mesa asignada a otro mesero. `OWNER`, `ADMIN` y `MANAGER` conservan las acciones administrativas permitidas.
- Solo `OWNER`, `ADMIN` o `MANAGER` puede transferir una sesión abierta a un usuario con membresía activa `WAITER` en el mismo local. La operación reasigna también el pedido activo vinculado, y audita sesión, responsable anterior/nuevo, actor y momento.
- Cada sesión de mesa mantiene un único pedido operativo reutilizable. Las rondas adicionales se agregan al mismo pedido hasta solicitar la cuenta; una vez solicitada, la sesión ya no acepta productos nuevos.

### 4.3 Pedidos, impresión y entrega

- En el MVP se habilitan `DINE_IN` y `TAKEAWAY`. `DINE_IN` requiere una sesión de mesa; `TAKEAWAY` no.
- Una sesión de mesa abierta reutiliza un solo pedido. El cliente puede pedir en varias rondas; cada ronda agrega ítems al mismo pedido y la cuenta reúne todo lo consumido durante esa sesión.
- El mesero imprime los productos nuevos desde el pedido. La salida se agrupa por estación y se envía al diálogo de impresión del navegador para usar la impresora física configurada. Reimprimir vuelve a imprimir los ítems enviados que sigan sin marcarse como entregados.
- La impresión física usa el diálogo del navegador; impresión silenciosa o integración directa con una impresora térmica requiere una integración de hardware futura.
- Al despachar a impresión, los ítems pasan de `PENDING` a `SENT`. El mesero marca cada ítem como `DELIVERED` al servirlo. El estado del pedido se calcula desde sus ítems y admite nuevas rondas mientras la sesión siga abierta y no se haya solicitado la cuenta.
- No se puede solicitar el cobro hasta que todos los ítems activos del pedido estén entregados. Después se cobra el total del pedido de la sesión y el pago completo cierra pedido y cuenta.
- Productos sin imprimir pueden editarse o quitarse. Los ya impresos no se borran silenciosamente: el mesero registra una cancelación con motivo y debe avisar a cocina de inmediato; el ítem conserva su historial y no se cobra.
- Un pedido completo solo puede cancelarse antes de imprimir productos. Los snapshots de producto, modificadores y precio preservan lo vendido aunque cambie el catálogo.
- Cada producto conserva una estación de preparación para agrupar el papel. Un combo no tiene representación comercial completa aún y requiere definición antes de venderse.
- `Customer` es opcional. Nadie necesita crear un cliente para vender; `customerName` libre no equivale a una entidad `Customer`.

### 4.4 Catálogo

- Categorías, productos, combos, grupos de modificadores y modificadores pertenecen a un local.
- Producto y demás elementos vendibles se desactivan para nuevas ventas en vez de borrarse si existen referencias históricas.
- Un producto tiene como máximo una estación de preparación en el MVP. No hay workflows secuenciales ni simultáneos de varias estaciones. La estación debe pertenecer al mismo local y estar activa al enviar el pedido.
- La cantidad de ítem debe admitir decimales para permitir fracciones sencillas (por ejemplo, 0,5 kg); no se necesita un sistema de conversión de unidades en el MVP.
- Horarios/calendarios de disponibilidad son posteriores al MVP.

### 4.5 Comandas impresas

- La pantalla y API operativa de Preparaciones se retiran. El personal de cocina no consulta ni modifica estados en el sistema.
- El mesero es responsable de enviar/reimprimir papel y registrar la entrega de cada producto. Las estaciones de producto se usan para agrupar renglones impresos.
- Los modelos y registros históricos de tickets de preparación se conservan para no perder historia; el flujo nuevo no los crea ni depende de ellos.
- Una cancelación posterior a impresión queda auditada y requiere aviso inmediato a cocina por parte del mesero. La confirmación es manual en este MVP.

### 4.6 Cuenta, descuentos, propina y pagos

- Una cuenta puede incluir uno o más pedidos y recibir varios pagos, incluso con diferentes métodos.
- En el flujo actual, la cuenta se solicita cuando todos los ítems activos del pedido de la sesión están marcados como entregados. Al confirmar el último pago, la cuenta queda `PAID` y los pedidos asociados pasan a `CLOSED` en la misma transacción.
- Métodos MVP: efectivo, tarjeta y transferencia. Un pago puede estar pendiente, confirmado, rechazado o cancelado según el flujo.
- El backend calcula subtotal, descuentos, propina y total; valida saldo pendiente y pagos acumulados dentro de transacciones.
- Los pagos `PENDING` reservan parte del saldo para evitar pagos en espera por sobre el total. No se cambia la propina mientras existan pagos pendientes o confirmados.
- La propina se registra por separado de ventas/ingreso neto del restaurante. Los reportes distinguen ventas brutas, descuentos, ventas netas y propinas.
- La cuenta propone por defecto una propina del 10% del subtotal después de descuentos y antes de propina; se imprime junto con los productos y el total sugerido. Antes de registrar pagos, el operador puede cambiarla a cero o a cualquier importe mayor o menor, y reimprimir la cuenta actualizada. El servidor persiste el importe y recalcula el total; no se calcula propina sobre otra propina.
- El frontend no puede imponer el total definitivo. Un mesero asignado puede confirmar el pago recibido para sus pedidos; el pago en efectivo genera una entrega pendiente que caja debe recibir y confirmar para reflejarse en el efectivo esperado. Si la cuenta no tiene mesero responsable (por ejemplo, un pedido para llevar cobrado directamente por caja/administración), el pago confirmado genera directamente un movimiento `SALE` en la sesión abierta, sin crear una entrega ficticia.
- Los pagos confirmados no se editan o eliminan como si no hubieran ocurrido; correcciones financieras deben quedar como reversas/acciones trazables.
- La creación de pago y movimiento manual requiere una clave de idempotencia para que los reintentos no dupliquen registros. Las operaciones de saldo y confirmación se ejecutan con aislamiento serializable y reintento acotado ante conflictos concurrentes.
- Un pago confirmado puede revertirse por una acción explícita con actor, fecha y motivo. La reversa conserva el pago original y actualiza el saldo pendiente. Si se revierte efectivo ya recibido en caja, se registra una salida `REFUND` en la caja abierta; si la entrega seguía pendiente se cancela sin movimiento. Los pagos no recibidos o rechazados nunca aumentan el efectivo esperado.

### 4.7 Caja

- `Payment` y `CashMovement` son conceptos distintos.
- Un pago confirmado en efectivo produce un único movimiento de caja asociado: `HANDOVER` al confirmar una entrega de mesero, o `SALE` cuando se cobra directamente sin mesero. Retiros, depósitos y ajustes son movimientos aunque no sean pagos.
- El historial de pagos de Caja presenta pagos de todos los métodos. Tarjeta y transferencia no aumentan el efectivo esperado; el pago en efectivo solo lo aumenta cuando caja confirma la recepción y registra el movimiento.
- Un movimiento manual requiere motivo para retiro, depósito y ajuste.
- Una caja no permite movimientos después del cierre.
- Hay como máximo una caja abierta por local, reforzado por índice único. Las altas de movimiento, recepción de entregas y cierre se serializan sobre la sesión para evitar efectos fuera de una caja cerrada o movimientos omitidos en el esperado.
- Al cierre se registra el monto esperado según apertura y movimientos, el monto contado y la diferencia.
- No debe haber más de una sesión de caja abierta por caja/local conforme a la definición operativa pendiente (ver decisiones).
- Entregas de efectivo entre mesero y caja registran quién entrega, quién recibe, monto, estado y confirmación.

### 4.8 Auditoría e integración interna

- Registrar acciones significativas: envío/cancelación/modificación de pedidos, cancelaciones de ítems, cambio/transferencia de mesero, descuentos, confirmación/reversa de pagos, movimientos y cierre de caja, y cambios de membresía/permisos.
- Como mínimo, el registro conserva `userId`, `businessId`, `locationId` cuando corresponda, acción, entidad, identificador, fecha y metadatos acotados.
- La auditoría mínima activa registra creación y cambios de estado de pedidos, creación/anulación y cambio de propina en cuentas, aplicación/retiro de descuentos, creación/confirmación/rechazo/cancelación de pagos, apertura/cierre de caja, confirmación/rechazo de entregas y movimientos manuales. Se escribe en la misma transacción que la acción auditada; si falla el registro, también falla la acción.
- La consulta de auditoría está disponible en `GET /audit-logs`, con filtros por local y entidad, límite máximo de 100 y acceso restringido a `OWNER`, `ADMIN` y `MANAGER`. No se exponen endpoints de edición o borrado de eventos.
- Los metadatos se limitan a contexto operativo necesario (por ejemplo, estado anterior/nuevo, monto, método y motivo). Nunca incluyen contraseñas, tokens, secretos ni datos de tarjeta.
- No registrar cada interacción de interfaz ni usar `AuditLog` como sustituto de estados/eventos de dominio.
- Objetivo: monolito modular con eventos internos para desacoplar reacciones como preparación, realtime, auditoría y reportes de la operación que los origina. El mecanismo de entrega fiable (transacción/outbox o alternativa) se selecciona según el riesgo de perder eventos; no se requiere microservicios.

### 4.9 Reporte de cierre diario

- `GET /reports/daily-close` recibe local y fecha (`YYYY-MM-DD`) y solo está disponible para `OWNER`, `ADMIN` y `MANAGER`.
- La fecha se interpreta usando la zona horaria configurada en el local.
- Las cuentas se agrupan por fecha de emisión; anuladas se cuentan por estado, pero se excluyen de subtotales, descuentos, propinas y total de ventas.
- Los pagos confirmados se agrupan por fecha de confirmación y método. Los pagos registrados se agrupan por fecha de creación y estado actual; por ello, el estado mostrado para una fecha pasada no es una reconstrucción histórica.
- La conciliación incluye las sesiones de caja cerradas en esa fecha e informa esperado, contado y diferencia (contado menos esperado).

El ranking de productos cuenta unidades no canceladas pertenecientes a pedidos `CLOSED` con cuenta `PAID` emitida en el día de la sucursal. No representa ingreso neto por producto ni incluye componentes de combos; estos límites se muestran en la interfaz.

### 4.10 Combos

- El combo se vende como una sola línea al precio propio configurado. Sus productos componentes se expanden para preparación agrupados por estación, conservando snapshot de combo, precio, productos, cantidades y estaciones al vender.
- Los componentes no se cobran como líneas independientes ni se les asigna ingreso comercial artificial. Descuentos se aplican a la línea del combo; informes futuros podrán contar ventas de combos y unidades preparadas como métricas distintas. Hasta que exista el modelo de líneas de combo, los combos no son vendibles desde pedidos ni aparecen en el ranking de productos.

### 4.11 Administración de usuarios

- Crear un usuario de personal crea su identidad y su membresía activa en una sola transacción. Se requiere nombre, apellido, correo, contraseña, rol y sucursal activa del negocio.
- La asignación de rol se valida en backend: `OWNER` administra roles operativos excepto `KITCHEN`; `ADMIN` no puede asignar `OWNER`; `MANAGER` solo puede asignar `WAITER` o `CASHIER`. El rol heredado `KITCHEN` no se asigna ni puede usar endpoints operativos.
- El administrador puede actualizar perfil, rol, sucursal asignada y estado activo/inactivo. No se elimina al personal desde el flujo normal para preservar referencias operacionales.
- La contraseña nunca se devuelve; se guarda con hash. El frontend valida formato de correo, longitud de nombre, contraseña, confirmación, sucursal y roles permitidos, mientras el backend repite las validaciones de seguridad.

### 4.12 Configuración del negocio y SaaS

- `OWNER` y `ADMIN` pueden consultar y actualizar nombre e identificador tributario del negocio y administrar nombre, dirección, zona horaria, moneda y estado operativo de sus sucursales.
- La sucursal no se puede desactivar mientras tenga una caja abierta o sesiones de mesa `OPEN`/`CLOSING`. Desactivar una sucursal no cancela ni cambia su suscripción.
- La configuración presenta en modo lectura el plan, estado, precio configurado, límites y periodo de la suscripción asociada a cada sucursal. El precio no se etiqueta como mensual porque el modelo no define periodicidad.
- No hay checkout, portal de facturación, cambio de plan, cancelación de suscripción ni administración de catálogo de planes. No se deben simular estas acciones en la interfaz.
- El alcance comercial objetivo es una suscripción por negocio. `maxLocations` cuenta locales activos; `maxUsers`, membresías activas del negocio; `maxProducts`, productos activos sumados entre locales. Los datos operativos y permisos continúan aislados por sucursal. Hasta que exista migración de consolidación y facturación, la relación actual de suscripción por sucursal es compatibilidad heredada de solo lectura, no una autorización para cobrar varias veces ni un contrato comercial.
- El MVP no incluye checkout, periodicidad/impuestos de cobro, portal de facturación, cambio/cancelación de plan ni aprovisionamiento SaaS automático. No se simulan estas acciones ni se permite crear locales desde configuración hasta definir la migración, el ciclo de facturación y los efectos de exceder límites.

## 5. Arquitectura de referencia

```text
Frontend web/PWA
       │ REST (y realtime cuando se incorpore)
       ▼
NestJS — monolito modular
  Identidad y tenancy
  Catálogo · Mesas · Pedidos · Impresión física
  Billing · Pagos · Caja · Auditoría · Reportes
       │
       └── Prisma → PostgreSQL
```

- El frontend actual es React + Vite, no Next.js. La mención anterior de Next.js/PWA describe una opción de arquitectura futura, no una migración aprobada. No migrar de framework como parte de correcciones funcionales sin una decisión explícita.
- Backend actual: NestJS y Prisma con PostgreSQL. Mantener módulos entendibles y evitar que `Orders` dependa rígidamente de caja, inventario o reportes.
- REST es el contrato existente. Realtime puede incorporarse después; la cocina opera con comandas impresas.
- Redis no es requisito del MVP hasta justificarlo por escala o necesidades de realtime.
- El servidor controla reglas, autorizaciones y cálculos; el frontend presenta el estado y solicita acciones válidas.

## 6. MVP

### Incluido

- Identidad, usuarios, roles/permisos básicos, negocio, locales y membresías.
- Configuración de mesas, estaciones, categorías, productos, combos y modificadores.
- Sesión de mesa y mesero asignado.
- Pedidos de mesa y para llevar, rondas en un único pedido por sesión, impresión por estación, entrega por ítem y cancelaciones trazables.
- Cuenta, descuentos, propinas, pagos parciales/mixtos, efectivo, tarjeta, transferencia, saldos pendientes.
- Caja, movimientos, entrega de efectivo y conciliación de cierre.
- Reporte de cierre diario por local, desglose de pagos por método y estado, conciliación de caja y auditoría básica. El ranking de productos queda para una iteración posterior.

### Fuera del MVP

Inventario avanzado, compras, proveedores, recetas/costos, inteligencia artificial, forecasting, delivery integrado, fidelización/puntos, preparación secuencial multiestación, integración directa con POS, integraciones bancarias y facturación electrónica.

La exclusión es de alcance, no una promesa de implementación futura. El diseño no debe bloquear extensiones razonables.

## 7. Estado observado en los repositorios (2026-10-19)

| Área                 | Estado encontrado                                                                                                                            | Diferencia relevante                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend              | NestJS/Prisma modular; módulos de auth, tenancy, catálogo, mesas, pedidos, bills, descuentos, pagos, caja, auditoría y reportes | Cierre diario por local, fecha y zona horaria; incluye cuentas emitidas (excluye anuladas de totales), pagos registrados/confirmados y cajas cerradas. No hay realtime.                                                |
| Tenancy              | `Business`, `Location`, `Membership` con rol y sucursal asignada                                                                             | Se aplica aislamiento por local a los endpoints operativos y se limita administración de personal del `MANAGER` a su local. El usuario confirmó que la migración de asignación de local a membresías ya está aplicada. |
| Sesión de mesa       | Estado y mesero asignado; un pedido reutilizable por sesión; transferencia administrativa auditada                                                   | Las migraciones de trazabilidad, unicidad de estaciones, disponibilidad operacional y cantidades fraccionarias ya fueron aplicadas y probadas por el usuario. El flujo de rondas usa bloqueo transaccional de la sesión; no requiere nueva migración. |
| Mesa                 | `ACTIVE` / `INACTIVE`; ocupación derivada de sesión                                                                                          | Estado operativo persistido `AVAILABLE`, `RESERVED`, `OUT_OF_SERVICE`; `OCCUPIED` se deriva.                                                                                                                          |
| Pedidos              | `DINE_IN` / `TAKEAWAY`; un pedido por sesión con rondas agregadas, impresión física por estación, entrega por ítem y cantidades fraccionarias hasta 3 decimales | Pedidos para llevar aceptan nombre opcional. La cuenta se solicita después de entregar todos los ítems de la sesión, se imprime para el cliente con la propina sugerida del 10% y permite ajustar la propina antes del pago.                                                                                                  |
| Ruteo de preparación | Una asignación por producto para agrupar la impresión por estación                                                                            | La base aplica unicidad por producto y requiere reconciliar duplicados preexistentes antes de crear el índice.                                                                                                        |
| Caja/pagos           | Modelos y API para bills, pagos, sesiones, movimientos y handovers; frontend con solicitud de cuenta, pagos y recepción básica de efectivo   | El flujo requiere una sesión abierta para confirmar efectivo y una confirmación de caja para que el movimiento se refleje en el saldo.                                                                                 |
| Autenticación        | Access token y refresh token en cookie, rotación y revocación                                                                                | El guard ahora rechaza solicitudes sin origen o desde un origen distinto a `FRONTEND_URL`; falta verificar configuración por ambiente y validar el flujo integrado.                                                    |
| Frontend             | React/Vite: login, mesas, catálogo, pedidos e impresión, cobro/caja, cierre diario, usuarios y configuración del negocio                    | Caja sincroniza automáticamente cada 15 s; la pantalla de Preparaciones y su endpoint se retiraron. Configuración SaaS es de consulta; contratación y cambios de plan no están integrados. No se encontró WebSocket.                      |

La tabla es un inventario preliminar por lectura de archivos. Antes de cambiar una regla, volver a verificar el código afectado y documentar evidencia; el esquema por sí solo no demuestra que un flujo esté completo.

## 8. Brechas para abordar

Orden recomendado después de este incremento:

1. **Verificación de seguridad:** recorrer la matriz con pruebas de autorización cruzada por rol/local, revisar rutas no pertenecientes al producto y verificar `FRONTEND_URL` por ambiente. La primera capa de guardas y alcance está implementada; la cobertura debe validarse en cada endpoint y flujo.
2. **Integridad concurrente y financiera:** validaciones de caja, pagos, idempotencia y reversas están implementadas; verificar con escenarios de concurrencia controlados antes de operación real.
3. **Trazabilidad operativa:** validar en operación real el flujo de impresión, reimpresión, entrega por ítem y aviso de cancelación impresa a cocina.
4. **Fidelidad adicional al dominio:** crear el modelo de línea de combo y snapshots comerciales; resolver inventario antes de ampliar esos flujos.
5. **Auditoría y eventos:** completar cobertura de cambios de membresía; luego desacoplar efectos mediante eventos/outbox si el riesgo lo justifica.
6. **Integración de frontend:** mantener los módulos de pedidos, impresión, mesas y catálogo alineados con el contrato del backend.

No se debe hacer una migración de esquema destructiva para “limpiar” el modelo. Cada cambio de esquema debe incluir una migración compatible con datos existentes y un plan para validar/recuperar.

## 9. Decisiones pendientes de confirmación

Estas preguntas no invalidan la línea base; delimitan decisiones que el código actual no resuelve de forma suficiente:

1. **Reserva de mesa:** MVP definido como bloqueo manual `RESERVED`. Si se requiere reserva con hora, cliente o duración, deberá añadirse un módulo de reservas separado.
2. **Caja:** ¿la caja se abre por local, por terminal/cajón físico, o puede haber varias sesiones abiertas simultáneas en el mismo local?
3. **Combos:** regla MVP definida: un renglón comercial al precio configurado; componentes se expanden para preparación por estación, sin ingreso distribuido a componentes.
4. **Propina:** base de sugerencia definida como subtotal menos descuentos, sin propina. La sugerencia predeterminada es 10% del subtotal menos descuentos, y se puede editar antes del pago; la distribución interna y reportes de propina por empleado quedan fuera del MVP.
5. **Alcance de sucursal:** cerrado para el MVP: `OWNER`/`ADMIN` tienen alcance de negocio; los demás roles solo acceden a su local asignado. Si luego se requieren excepciones por persona, deberán modelarse como permisos explícitos, no ampliando implícitamente el rol.
6. **SaaS y suscripciones:** alcance objetivo definido por negocio; límites agregados al negocio. Pendiente diseñar el ciclo de cobro, impuestos, migración de suscripciones por sucursal y reglas de gracia/bloqueo antes de habilitar contratación, cambios o aprovisionamiento.

Resolver cada decisión en este documento antes de implementar la regla correspondiente. Las preguntas no deben frenar correcciones de seguridad o integridad que no dependan de ellas.

## 10. Control de cambios y versionado

Usamos versionado semántico para la especificación:

- **MAJOR:** cambia una regla de negocio aprobada o el alcance central del MVP.
- **MINOR:** agrega un módulo, entidad, flujo o regla compatible con lo acordado.
- **PATCH:** corrige precisión, evidencia o redacción sin cambiar el comportamiento esperado.

Toda actualización debe cambiar la versión, la fecha y este historial. Una decisión de producto no se modifica solo porque el código actual tenga otro comportamiento; se registra explícitamente la decisión y su impacto en datos/API.

### Historial

| Versión | Fecha      | Cambio                                                                                                                                                                                                                  |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.15.0  | 2026-10-19 | Imprime la cuenta al generarla, sugiere propina editable del 10% y limita al mesero a sus mesas y pedidos; el backend impide cerrar sesiones de otros meseros. |
| 0.14.0  | 2026-10-19 | Retira el módulo operativo de Preparaciones; imprime comandas por estación, agrega rondas al mismo pedido por sesión de mesa y permite cobrar tras marcar todos los productos entregados. |
| 0.13.0  | 2026-10-19 | Permite agrupar pedidos entregados de una mesa en una cuenta, registra cantidades fraccionarias hasta 3 decimales con migración compatible, hace opcional el nombre para llevar y sincroniza Caja automáticamente.        |
| 0.1.0   | 2026-10-19 | Línea base inicial: visión original, reglas del dominio, alcance MVP y contraste con los repositorios actuales. Pendiente validar decisiones de la sección 9.                                                           |
| 0.1.1   | 2026-10-19 | Actualiza el estado observado tras implementar la validación de origen y agregar la migración para impedir sesiones activas duplicadas por mesa.                                                                        |
| 0.2.0   | 2026-10-19 | Añade el flujo funcional desde pedido entregado a cuenta pagada, cierre de pedido y recepción de efectivo en Caja.                                                                                                      |
| 0.2.1   | 2026-10-19 | Documenta el saldo reservado por pagos pendientes y el bloqueo de cambios de propina durante el cobro.                                                                                                                  |
| 0.2.2   | 2026-10-19 | Aclara la diferencia entre el historial de pagos y el saldo físico esperado, y registra pagos visibles en Caja con el estado de recepción de efectivo.                                                                  |
| 0.3.0   | 2026-10-19 | Define e implementa auditoría mínima transaccional para operaciones de pedidos, cuentas, descuentos, pagos y caja, con consulta administrativa filtrable.                                                               |
| 0.4.0   | 2026-10-19 | Implementa reporte de cierre diario por local, con filtros de fecha, desglose de cuentas/pagos y conciliación de sesiones de caja.                                                                                      |
| 0.5.0   | 2026-10-19 | Implementa administración frontend de usuarios y membresías con rol/sucursal, creación transaccional, edición, activación y restricciones por rol.                                                                      |
| 0.6.0   | 2026-10-19 | Implementa configuración de datos del negocio y sucursales, con vista de suscripciones SaaS y controles de acceso/validación.                                                                                           |
| 0.7.0   | 2026-10-19 | Define la matriz de permisos por rol, aplica aislamiento por local en backend y limita la gestión de personal del `MANAGER` a su local; deshabilita el CRUD de demostración sin aislamiento (`/posts`).                 |
| 0.8.0   | 2026-10-19 | Permite al `WAITER` registrar y confirmar/cancelar pagos solo de cuentas cuyos pedidos están todos asignados a su usuario; mantiene el rechazo de pagos y la recepción de efectivo bajo control de caja/administración. |
| 0.9.0   | 2026-10-19 | Protege las rutas y navegación frontend por rol; añade límites a login, registro y renovación de sesión, normalización/validación de registro y mensajes de autenticación más claros.                                   |
| 0.10.0  | 2026-10-19 | Consolida las transiciones de pedido por acción; añade idempotencia de pagos, operaciones serializables para pagos/caja, unicidad de caja abierta, y reversas financieras auditadas con conciliación de efectivo.       |
| 0.10.1  | 2026-10-19 | Define el cobro directo en efectivo para cuentas sin mesero: crea un movimiento `SALE` en caja sin generar una entrega entre mesero y cajero.                                                                           |
| 0.11.0  | 2026-10-19 | Añade solicitud/resolución de cancelación de ítem por preparación, enmienda trazable de notas, transferencia auditada de mesa y regla de una estación por producto con migración de unicidad.                           |
| 0.12.0  | 2026-10-19 | Separa disponibilidad operativa de activación de mesa; define regla de propina y combos, alcance objetivo de suscripción SaaS por negocio, e implementa ranking diario de productos sobre pedidos pagados.              |
