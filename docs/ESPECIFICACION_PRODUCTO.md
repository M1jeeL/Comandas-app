# Mesa Pro — Especificación de producto y dominio

**Versión:** 0.6.0  
**Estado:** línea base inicial; requiere validación de decisiones marcadas como pendientes  
**Actualizado:** 2026-10-19  
**Autoridad:** este documento es la referencia funcional para planificar y revisar cambios. Si el código contradice una regla aquí aprobada, se registra la diferencia y se corrige el código; no se cambia la regla de forma implícita.

## 1. Propósito y alcance

Mesa Pro es una plataforma SaaS para la operación diaria de restaurantes. El producto cubre operación, preparación, cobro y control básico del negocio. No es únicamente un sistema para tomar pedidos.

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

| Término | Significado |
|---|---|
| `Business` | Negocio/empresa cliente de Mesa Pro. Puede tener varios locales. |
| `Location` | Local del negocio. Unidad de aislamiento de la operación. |
| `User` | Persona con credenciales de acceso. |
| `Membership` | Relación de un usuario con un negocio, con rol y estado. |
| `Workstation` | Estación de preparación, por ejemplo Cocina, Bar o Parrilla. |
| `Device` | Dispositivo de operación asociado a una estación. **Aún no aparece en el esquema actual.** |
| `RestaurantTable` | Mesa física del local. No representa una cuenta ni una ocupación. |
| `TableSession` | Ocupación temporal de una mesa, con mesero responsable y pedidos asociados. |
| `Order` | Pedido de cliente, con tipo, estado e ítems. |
| `PreparationTicket` | Comanda que reúne los ítems de un pedido destinados a una estación. |
| `Bill` | Cuenta/cobro que agrupa uno o más pedidos y contiene descuentos, propina y pagos. |
| `Payment` | Pago registrado con método, monto y estado. Puede ser parcial. |
| `CashMovement` | Entrada o salida de dinero de caja; no equivale necesariamente a un pago. |
| `CashSession` | Apertura y cierre de una caja, con monto esperado y monto contado. |
| `AuditLog` | Registro transversal de acciones relevantes para seguridad, dinero y operación. No sustituye entidades de dominio. |

## 4. Reglas de dominio

### 4.1 Tenencia, identidad y permisos

- Un negocio contiene uno o más locales.
- La operación pertenece a un local: mesas, catálogo, pedidos, preparación, cuentas y caja.
- Una persona accede mediante una membresía activa y un rol.
- Cada membresía tiene una sucursal asignada para administración y operación del personal. **Actualmente esta asignación no limita por sí sola el acceso a otras sucursales**: los endpoints existentes autorizan por negocio. La autorización por sucursal requiere una decisión y una implementación transversal antes de tratarla como límite de seguridad.
- El backend deriva el negocio y el usuario desde la sesión autenticada y valida que el local solicitado pertenezca a ese negocio. Un `locationId` enviado por el cliente nunca es prueba de autorización.
- La autorización debe aplicarse en cada operación y sobre la entidad concreta; ocultar botones en el frontend no es control de acceso.
- Roles iniciales del código: `OWNER`, `ADMIN`, `MANAGER`, `WAITER`, `KITCHEN`, `CASHIER`. Las capacidades detalladas por rol requieren una matriz explícita antes de cerrar permisos del MVP.
- Los dispositivos se asocian a una estación y la persona inicia sesión desde el dispositivo. **Este flujo es objetivo, no está modelado aún.**

### 4.2 Mesas y sesiones

- La mesa es infraestructura física; su estado operacional no se deduce solo de la sesión.
- Estados objetivo de mesa: `AVAILABLE`, `OCCUPIED`, `RESERVED`, `OUT_OF_SERVICE`.
- Estados de `TableSession`: `OPEN`, `CLOSING`, `CLOSED`, `CANCELLED`.
- Una mesa no puede tener más de una sesión activa a la vez.
- Una sesión cerrada o cancelada no acepta pedidos.
- La apertura asigna un mesero responsable. Solo esa persona puede gestionar la sesión, salvo permiso explícito.
- La transferencia de responsabilidad es una acción explícita, registra origen, destino, actor y momento.
- La mesa puede recibir varios pedidos durante una sesión.

### 4.3 Pedidos y comandas

- `OrderType` existe aunque no todos los tipos se implementen en el MVP. Tipos futuros previstos: `DINE_IN`, `TAKEAWAY`, `DELIVERY`, `PICKUP`, `OTHER`.
- En el MVP se habilitan `DINE_IN` y `TAKEAWAY`. `DINE_IN` requiere sesión de mesa; `TAKEAWAY` no.
- Un pedido puede contener varios ítems. Un producto tiene una estación de preparación para el MVP.
- Al enviar un pedido, los ítems se agrupan por estación: un ticket por combinación de pedido y estación, no un ticket por producto.
- Un combo puede expandirse en productos enviados a distintas estaciones. **La representación del combo vendido y sus snapshots comerciales requiere definición antes de implementarla.**
- Estados objetivo de pedido: `DRAFT`, `SENT`, `IN_PROGRESS`, `READY`, `DELIVERED`, `CLOSED`, `CANCELLED`.
- El estado del pedido debe reflejar/controlar el flujo de sus ítems y tickets. No debe ser un campo libremente editable por el frontend. Las transiciones vigentes deben definirse en el dominio.
- No se envía un pedido vacío ni se modifica libremente un pedido cerrado.
- Los ítems cancelados no se borran. Se conserva cantidad original, cantidad cancelada, actor, hora y motivo; si ya fue enviado a preparación, se solicita y registra su cancelación en el flujo de preparación.
- Las modificaciones posteriores deben conservar el antes/después y quién/cuándo. No se requiere event sourcing completo.
- El nombre y precio del producto se copian al ítem al momento de la venta. Un cambio de catálogo no altera pedidos existentes. La misma regla aplica a modificadores, descuentos y combos.
- `Customer` es opcional. Nadie debe tener que crear una cuenta de cliente para vender. `customerName` libre no equivale aún a una entidad `Customer`.

### 4.4 Catálogo

- Categorías, productos, combos, grupos de modificadores y modificadores pertenecen a un local.
- Producto y demás elementos vendibles se desactivan para nuevas ventas en vez de borrarse si existen referencias históricas.
- Un producto tiene una estación de preparación en el MVP. No hay workflows secuenciales de varias estaciones.
- La cantidad de ítem debe admitir decimales para permitir fracciones sencillas (por ejemplo, 0,5 kg); no se necesita un sistema de conversión de unidades en el MVP.
- Horarios/calendarios de disponibilidad son posteriores al MVP.

### 4.5 Preparación

- Un ticket agrupa los ítems de un pedido para una estación.
- Estados objetivo: `PENDING`, `ACCEPTED`, `IN_PROGRESS`, `READY`, `CANCELLED` (el flujo puede omitir `ACCEPTED` si no se necesita en una estación).
- `READY` no retrocede a un estado anterior mediante una edición ordinaria. Cualquier corrección futura debe ser una operación explícita y auditada.
- `CANCELLED` no continúa preparación.
- Cancelar ítems ya enviados debe informar a la estación y preservar el historial; nunca se elimina silenciosamente el ítem.

### 4.6 Cuenta, descuentos, propina y pagos

- Una cuenta puede incluir uno o más pedidos y recibir varios pagos, incluso con diferentes métodos.
- En el flujo actual, la cuenta se solicita después de marcar el pedido como `DELIVERED`. Al confirmar el último pago, la cuenta queda `PAID` y los pedidos asociados pasan a `CLOSED` en la misma transacción.
- Métodos MVP: efectivo, tarjeta y transferencia. Un pago puede estar pendiente, confirmado, rechazado o cancelado según el flujo.
- El backend calcula subtotal, descuentos, propina y total; valida saldo pendiente y pagos acumulados dentro de transacciones.
- Los pagos `PENDING` reservan parte del saldo para evitar pagos en espera por sobre el total. No se cambia la propina mientras existan pagos pendientes o confirmados.
- La propina se registra por separado de ventas/ingreso neto del restaurante. Los reportes distinguen ventas brutas, descuentos, ventas netas y propinas.
- El cliente no puede imponer el total definitivo ni confirmar pagos que requieran confirmación del negocio.
- Los pagos confirmados no se editan o eliminan como si no hubieran ocurrido; correcciones financieras deben quedar como reversas/acciones trazables.

### 4.7 Caja

- `Payment` y `CashMovement` son conceptos distintos.
- Un pago confirmado en efectivo puede producir un movimiento de caja asociado. Retiros, depósitos y ajustes son movimientos aunque no sean pagos.
- El historial de pagos de Caja presenta pagos de todos los métodos. Tarjeta y transferencia no aumentan el efectivo esperado; el pago en efectivo solo lo aumenta cuando caja confirma la recepción y registra el movimiento.
- Un movimiento manual requiere motivo para retiro, depósito y ajuste.
- Una caja no permite movimientos después del cierre.
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

### 4.10 Administración de usuarios

- Crear un usuario de personal crea su identidad y su membresía activa en una sola transacción. Se requiere nombre, apellido, correo, contraseña, rol y sucursal activa del negocio.
- La asignación de rol se valida en backend: `OWNER` administra todos los roles; `ADMIN` no puede asignar `OWNER`; `MANAGER` solo puede asignar `WAITER`, `KITCHEN` o `CASHIER`.
- El administrador puede actualizar perfil, rol, sucursal asignada y estado activo/inactivo. No se elimina al personal desde el flujo normal para preservar referencias operacionales.
- La contraseña nunca se devuelve; se guarda con hash. El frontend valida formato de correo, longitud de nombre, contraseña, confirmación, sucursal y roles permitidos, mientras el backend repite las validaciones de seguridad.

### 4.11 Configuración del negocio y SaaS

- `OWNER` y `ADMIN` pueden consultar y actualizar nombre e identificador tributario del negocio y administrar nombre, dirección, zona horaria, moneda y estado operativo de sus sucursales.
- La sucursal no se puede desactivar mientras tenga una caja abierta o sesiones de mesa `OPEN`/`CLOSING`. Desactivar una sucursal no cancela ni cambia su suscripción.
- La configuración presenta en modo lectura el plan, estado, precio configurado, límites y periodo de la suscripción asociada a cada sucursal. El precio no se etiqueta como mensual porque el modelo no define periodicidad.
- No hay checkout, portal de facturación, cambio de plan, cancelación de suscripción ni administración de catálogo de planes. No se deben simular estas acciones en la interfaz.
- El esquema relaciona una suscripción con cada sucursal, mientras los planes también exponen un límite `maxLocations`. El significado de ese límite y la provisión SaaS al crear una sucursal requieren una decisión antes de habilitar creación de sucursales desde este módulo.

## 5. Arquitectura de referencia

```text
Frontend web/PWA
       │ REST (y realtime cuando se incorpore)
       ▼
NestJS — monolito modular
  Identidad y tenancy
  Catálogo · Mesas · Pedidos · Preparación
  Billing · Pagos · Caja · Auditoría · Reportes
       │
       └── Prisma → PostgreSQL
```

- El frontend actual es React + Vite, no Next.js. La mención anterior de Next.js/PWA describe una opción de arquitectura futura, no una migración aprobada. No migrar de framework como parte de correcciones funcionales sin una decisión explícita.
- Backend actual: NestJS y Prisma con PostgreSQL. Mantener módulos entendibles y evitar que `Orders` dependa rígidamente de caja, inventario o reportes.
- REST es el contrato existente. Realtime puede incorporarse después; hoy la preparación usa polling.
- Redis no es requisito del MVP hasta justificarlo por escala o necesidades de realtime.
- El servidor controla reglas, autorizaciones y cálculos; el frontend presenta el estado y solicita acciones válidas.

## 6. MVP

### Incluido

- Identidad, usuarios, roles/permisos básicos, negocio, locales y membresías.
- Configuración de mesas, estaciones, categorías, productos, combos y modificadores.
- Sesión de mesa y mesero asignado.
- Pedidos de mesa y para llevar, ítems, tickets de preparación, modificaciones y cancelaciones trazables.
- Cuenta, descuentos, propinas, pagos parciales/mixtos, efectivo, tarjeta, transferencia, saldos pendientes.
- Caja, movimientos, entrega de efectivo y conciliación de cierre.
- Reporte de cierre diario por local, desglose de pagos por método y estado, conciliación de caja y auditoría básica. El ranking de productos queda para una iteración posterior.

### Fuera del MVP

Inventario avanzado, compras, proveedores, recetas/costos, inteligencia artificial, forecasting, delivery integrado, fidelización/puntos, preparación secuencial multiestación, integración directa con POS, integraciones bancarias y facturación electrónica.

La exclusión es de alcance, no una promesa de implementación futura. El diseño no debe bloquear extensiones razonables.

## 7. Estado observado en los repositorios (2026-10-19)

| Área | Estado encontrado | Diferencia relevante |
|---|---|---|
| Backend | NestJS/Prisma modular; módulos de auth, tenancy, catálogo, mesas, pedidos, preparación, bills, descuentos, pagos, caja, auditoría y reportes | Cierre diario por local, fecha y zona horaria; incluye cuentas emitidas (excluye anuladas de totales), pagos registrados/confirmados y cajas cerradas. No hay realtime. |
| Tenancy | `Business`, `Location`, `Membership` con rol y sucursal asignada; consulta de usuarios protegida por rol | La sucursal de membresía es asignación administrativa; el alcance de autorización sigue siendo el negocio completo. La nueva migración debe aplicarse en cada base de datos. |
| Sesión de mesa | Estado y mesero asignado; varias órdenes enlazables | No existe transferencia explícita. Se agregó una migración para garantizar una sesión `OPEN`/`CLOSING` por mesa; aún requiere aplicarse y verificarse en cada base de datos. |
| Mesa | `ACTIVE` / `INACTIVE` | No modela los estados operativos `AVAILABLE`, `OCCUPIED`, `RESERVED`, `OUT_OF_SERVICE`. |
| Pedidos | `DINE_IN` / `TAKEAWAY`; estados y tickets por estación; snapshot de producto/precio | Cantidad es entera. No se encontró flujo explícito de solicitud de cancelación de preparación ni historial completo de modificaciones. |
| Ruteo de preparación | Relación `ProductWorkstation` y ticket agrupado por pedido/estación | El esquema permite varias estaciones por producto, contrario a la regla MVP de una estación. |
| Caja/pagos | Modelos y API para bills, pagos, sesiones, movimientos y handovers; frontend con solicitud de cuenta, pagos y recepción básica de efectivo | El flujo requiere una sesión abierta para confirmar efectivo y una confirmación de caja para que el movimiento se refleje en el saldo. |
| Autenticación | Access token y refresh token en cookie, rotación y revocación | El guard ahora rechaza solicitudes sin origen o desde un origen distinto a `FRONTEND_URL`; falta verificar configuración por ambiente y validar el flujo integrado. |
| Frontend | React/Vite: login, mesas, catálogo, pedidos, preparación, cobro/caja, cierre diario, usuarios y configuración del negocio | Configuración SaaS es de consulta; contratación y cambios de plan no están integrados. No se encontró WebSocket. |

La tabla es un inventario preliminar por lectura de archivos. Antes de cambiar una regla, volver a verificar el código afectado y documentar evidencia; el esquema por sí solo no demuestra que un flujo esté completo.

## 8. Brechas para abordar

Orden recomendado, pendiente de revisión técnica al iniciar cada cambio:

1. **Seguridad y aislamiento:** revisar alcance de acceso por `businessId` y `locationId`, permisos por acción y respuestas que no filtren datos de otros locales; verificar `FRONTEND_URL` por ambiente.
2. **Integridad concurrente:** aplicar y validar la nueva migración de unicidad de sesión activa; analizar simultaneidad en caja, saldos y confirmación de pagos.
3. **Reglas financieras:** verificar cálculo servidor, pagos parciales/mixtos, idempotencia de confirmaciones y reversas; no modificar registros monetarios confirmados sin trazabilidad.
4. **Fidelidad al dominio:** resolver estación única, estados de mesa, cantidad decimal, transferencias, cancelaciones y modificaciones auditables.
5. **Auditoría y eventos:** completar cobertura de cambios de ítems, transferencias y membresías; luego desacoplar efectos de dominio donde aporte claridad y fiabilidad.
6. **Integración de frontend:** completar módulos pendientes de usuarios/configuración y mantener el contrato de API explícito.

No se debe hacer una migración de esquema destructiva para “limpiar” el modelo. Cada cambio de esquema debe incluir una migración compatible con datos existentes y un plan para validar/recuperar.

## 9. Decisiones pendientes de confirmación

Estas preguntas no invalidan la línea base; delimitan decisiones que el código actual no resuelve de forma suficiente:

1. **Mesa reservada:** ¿`RESERVED` significa reserva programada y requiere entidad/horario de reserva, o solo bloqueo manual de disponibilidad?
2. **Caja:** ¿la caja se abre por local, por terminal/cajón físico, o puede haber varias sesiones abiertas simultáneas en el mismo local?
3. **Mesero responsable:** ¿el control de “solo el asignado” aplica solo a cambios de la sesión y sus pedidos, o también a agregar/cancelar ítems después del envío? ¿Qué roles pueden intervenir?
4. **Cancelación post-envío:** ¿la cocina debe aceptar/rechazar la solicitud, o el mesero puede cancelarla inmediatamente dejando registro?
5. **Combos:** ¿se vende un renglón de combo con precio propio y se desglosan componentes solo para preparación, o cada componente tiene importe distribuido en la cuenta?
6. **Propina:** ¿se calcula sobre subtotal, neto tras descuento u otra base? ¿Puede pagarse con método distinto al de la cuenta?
7. **Alcance de sucursal:** la membresía ya conserva una sucursal asignada. Falta decidir si debe limitar el acceso a datos/operaciones de otros locales; hasta que se implemente esa autorización transversal, el backend mantiene el acceso por negocio.
8. **SaaS y suscripciones:** definir si el plan y sus límites se aplican por negocio o sucursal, cómo se cobra periodicidad/impuestos, y cómo se provisiona/cancela un plan antes de permitir cambios de suscripción o creación de sucursales desde la configuración.

Resolver cada decisión en este documento antes de implementar la regla correspondiente. Las preguntas no deben frenar correcciones de seguridad o integridad que no dependan de ellas.

## 10. Control de cambios y versionado

Usamos versionado semántico para la especificación:

- **MAJOR:** cambia una regla de negocio aprobada o el alcance central del MVP.
- **MINOR:** agrega un módulo, entidad, flujo o regla compatible con lo acordado.
- **PATCH:** corrige precisión, evidencia o redacción sin cambiar el comportamiento esperado.

Toda actualización debe cambiar la versión, la fecha y este historial. Una decisión de producto no se modifica solo porque el código actual tenga otro comportamiento; se registra explícitamente la decisión y su impacto en datos/API.

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1.0 | 2026-10-19 | Línea base inicial: visión original, reglas del dominio, alcance MVP y contraste con los repositorios actuales. Pendiente validar decisiones de la sección 9. |
| 0.1.1 | 2026-10-19 | Actualiza el estado observado tras implementar la validación de origen y agregar la migración para impedir sesiones activas duplicadas por mesa. |
| 0.2.0 | 2026-10-19 | Añade el flujo funcional desde pedido entregado a cuenta pagada, cierre de pedido y recepción de efectivo en Caja. |
| 0.2.1 | 2026-10-19 | Documenta el saldo reservado por pagos pendientes y el bloqueo de cambios de propina durante el cobro. |
| 0.2.2 | 2026-10-19 | Aclara la diferencia entre el historial de pagos y el saldo físico esperado, y registra pagos visibles en Caja con el estado de recepción de efectivo. |
| 0.3.0 | 2026-10-19 | Define e implementa auditoría mínima transaccional para operaciones de pedidos, cuentas, descuentos, pagos y caja, con consulta administrativa filtrable. |
| 0.4.0 | 2026-10-19 | Implementa reporte de cierre diario por local, con filtros de fecha, desglose de cuentas/pagos y conciliación de sesiones de caja. |
| 0.5.0 | 2026-10-19 | Implementa administración frontend de usuarios y membresías con rol/sucursal, creación transaccional, edición, activación y restricciones por rol. |
| 0.6.0 | 2026-10-19 | Implementa configuración de datos del negocio y sucursales, con vista de suscripciones SaaS y controles de acceso/validación. |

