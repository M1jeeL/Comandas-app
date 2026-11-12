# Dashboard de negocio

`GET /dashboard?locationId=<uuid>&period=7d` devuelve una vista por sucursal. `period` admite `today`, `7d` y `30d`; los días se calculan en la zona horaria del local y el período incluye hoy. La comparación utiliza el mismo número de días anteriores completos. El filtro no modifica el estado actual de mesas, caja o pendientes.

## Indicadores y criterios

- **Ventas netas:** subtotal menos descuentos de cuentas actualmente pagadas y emitidas en el período. No incluye propinas. Una venta para llevar pagada se incluye aunque todavía no se haya retirado.
- **Ticket promedio:** ventas netas divididas por cantidad de cuentas pagadas emitidas en el período. Una cuenta puede contener varios pedidos.
- **Cobros netos:** pagos confirmados en el período menos reversas realizadas en el período. Incluye propinas y puede diferir de ventas netas por las fechas y conceptos involucrados.
- **Cuentas por cobrar:** saldo actual de cuentas abiertas, impagas o parcialmente pagadas, descontando únicamente pagos confirmados. Los saldos negativos se muestran como cero.
- **Productos más vendidos:** unidades en pedidos con cuenta pagada emitida en el período; excluye productos cancelados o con anulación pendiente/aprobada. Se consolidan por ID de producto.
- **Efectivo esperado:** apertura de la sesión más movimientos de ingreso, menos retiros y devoluciones. Los ajustes mantienen su signo. Las entregas de efectivo pendientes no se suman al saldo: una entrega confirmada ya tiene su movimiento de caja.
- **Ocupación:** mesas ocupadas sobre total de mesas activas de la sucursal. Las mesas activas fuera de servicio se muestran separadas.
- **Seguimiento:** hasta ocho pedidos abiertos, de más antiguo a más nuevo. Incluye los entregados que todavía requieren cierre. La antigüedad corresponde a la creación del pedido; no es un tiempo de preparación medido.

No se presentan utilidades o márgenes porque el modelo actual no registra costos del negocio. Los indicadores muestran ventas, cobros y operación.

## Permisos

El endpoint usa `ScopedJwtAuthGuard` y valida rol, negocio, local activo y sucursal asignada en el servicio:

- OWNER / ADMIN: sucursales activas de su negocio, con indicadores financieros.
- MANAGER: sucursal asignada, con indicadores financieros.
- CASHIER: operación y caja de su sucursal, sin agregados financieros globales.
- WAITER: pedidos y sesiones asignados a su usuario; ocupación general de mesas que ya puede consultar en el módulo Mesas. No se consultan ni devuelven finanzas o caja.
- KITCHEN: sin acceso al dashboard operativo.

El frontend consulta cada minuto y permite actualizar manualmente. Se separan las claves de caché por membresía, rol, sucursal y período. El gráfico se carga con el módulo de dashboard para no añadir su peso al login.

## Navegación

`/login` está bajo `PublicRoute`: espera a restaurar la sesión y envía al usuario autenticado al inicio de su rol con reemplazo de historial. Sin sesión permite el formulario.

El pedido seleccionado conserva su UUID en `/pedidos?order=<uuid>`. Al crear, se selecciona inmediatamente la respuesta del servidor y se actualiza explícitamente ese ID; no se reutiliza el ID anterior capturado por la función de actualización. Los enlaces del asistente con `focus=billing` siguen funcionando.

## Validación

Backend:

```powershell
npm run build
node --test test/dashboard.test.mjs test/assistant.test.mjs test/gemini-assistant.test.mjs test/takeaway-flow.test.mjs
```

Frontend:

```powershell
npm run build
npm run test:navigation
```

Las pruebas de navegación usan jsdom, Vite y un servidor HTTP local con datos ficticios. No usan la base de datos, credenciales ni Gemini reales. Verifican el dashboard autenticado, el cambio de período, la creación desde un pedido anterior, la conservación al recargar y el acceso a login con/sin sesión. Para una revisión visual se puede iniciar `node test/ui-fixture.mjs` y Vite con `VITE_API_URL=http://127.0.0.1:4319`, host `127.0.0.1` y puerto `5189`. El servidor de prueba solo escucha en loopback y no debe publicarse.
