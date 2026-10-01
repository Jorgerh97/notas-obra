import json, time
import os; os.makedirs("shots", exist_ok=True)
from playwright.sync_api import sync_playwright
errs=[]
def shot(p,n): p.screenshot(path=f'shots/{n}.png')
with sync_playwright() as pw:
    b=pw.chromium.launch(args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
    ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, locale='es-ES', timezone_id='Europe/Madrid', permissions=['microphone'])
    p=ctx.new_page()
    p.on('console', lambda m: m.type=='error' and errs.append(m.text))
    p.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    p.route('**/transcribir', lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin':'http://localhost:8080'}, body=json.dumps({'texto':'Para la de Mallorca hay que confirmar el hormigonado del jueves, avísame mañana a las siete y media. Y pedir al fontanero presupuesto de bajantes.'})))
    p.goto('http://localhost:8080/'); p.wait_for_timeout(800)
    assert '#/ajustes' in p.url, p.url
    p.fill('#cfg-url','http://localhost:8787'); p.fill('#cfg-token','secreto'); p.fill('#cfg-disp','Móvil Jorge')
    p.click('text=Guardar y probar conexión'); p.wait_for_timeout(1200)
    print('conexión:', p.inner_text('#cfg-res'))
    # etiquetas
    for nombre,tipo,alias in [('Mallorca245','obra','la de Mallorca, Mallorca'),('Instalaciones','industrial','instalador'),('Llamar','accion','')]:
        p.click('[data-act=etq-nueva]'); p.fill('#me-nombre',nombre); p.select_option('#me-tipo',tipo); p.fill('#me-alias',alias); p.click('[data-act=me-guardar]'); p.wait_for_timeout(300)
    p.click('[data-act=per-nueva]'); p.fill('#mp-nombre','Encargado'); p.fill('#mp-cargo','Obra Mallorca'); p.click('[data-act=mp-guardar]'); p.wait_for_timeout(300)
    p.click('[data-act=etq-editar] >> nth=0'); p.wait_for_timeout(200); shot(p,'m-etiqueta-modal'); p.click('[data-act=modal-cerrar]')
    shot(p,'m-ajustes')
    p.click('.page-head [data-act=cerrar]'); p.wait_for_timeout(300)
    # nueva nota con #
    p.click('.bottombar >> text=Nueva nota'); p.wait_for_timeout(300)
    p.fill('[data-ed=titulo]','Revisar línea de vida cubierta')
    p.click('#ed-cuerpo'); p.keyboard.type('Falta certificado del instalador #mal'); p.wait_for_timeout(200)
    shot(p,'m-editor-sugerencia')
    p.keyboard.press('Enter'); p.wait_for_timeout(200)
    p.keyboard.type(' y comprobar anclajes #Nueva_Etq'); p.wait_for_timeout(200)
    print('sugerencias:', p.inner_text('#sug'))
    p.keyboard.press('Escape')
    p.click('[data-act=ed-prio][data-v=alta]')
    print('cuerpo:', repr(p.input_value('#ed-cuerpo')))
    shot(p,'m-editor')
    p.click('[data-act=ed-guardar]'); p.wait_for_timeout(800)
    # dictado
    p.click('.bottombar >> text=Dictar'); p.wait_for_timeout(300)
    p.click('[data-act=rec-empezar]'); p.wait_for_timeout(3500); shot(p,'m-grabando')
    p.click('[data-act=rec-parar]'); p.wait_for_timeout(2500)
    shot(p,'m-revision'); p.screenshot(path='shots/m-revision-full.png', full_page=True)
    p.click('[data-act=p-nueva][data-v=crear]'); p.wait_for_timeout(200)
    p.click('[data-act=dic-guardar]'); p.wait_for_timeout(1500)
    shot(p,'m-lista')
    # marcar hecha + deshacer
    p.click('.nota .tick >> nth=0'); p.wait_for_timeout(900); shot(p,'m-deshacer')
    p.click('.toast >> text=Deshacer'); p.wait_for_timeout(500)
    # filtros y grupo
    p.click('.toolbar >> text=Filtros'); p.wait_for_timeout(300)
    p.click('[data-act=f-tag] >> text=#Mallorca245'); p.wait_for_timeout(200); shot(p,'m-filtros')
    p.click('.page-foot >> text=Guardar como grupo'); p.fill('#mg-nombre','Mallorca'); p.click('[data-act=mg-guardar]'); p.wait_for_timeout(300)
    p.click('.page-foot [data-act=cerrar]'); p.wait_for_timeout(300); shot(p,'m-grupo')
    p.click('.chips [data-act=vista][data-id=""]')
    # historial y revisión
    p.goto('http://localhost:8080/#/historial'); p.wait_for_timeout(700); shot(p,'m-historial')
    p.goto('http://localhost:8080/#/revision'); p.wait_for_timeout(500); shot(p,'m-revision-semanal')
    p.goto('http://localhost:8080/#/'); p.wait_for_timeout(1500)
    datos=p.evaluate("fetch('http://localhost:8787/datos',{headers:{Authorization:'Bearer secreto'}}).then(r=>r.json())")
    print('servidor: notas', [(n['titulo'],n['prioridad'],len(n['etiquetas']),n['alarma']) for n in datos['notas']])
    print('servidor: etiquetas', [e['nombre'] for e in datos['etiquetas']], 'vistas', [v['nombre'] for v in datos['vistas']])
    # escritorio
    d=b.new_context(viewport={'width':1440,'height':900}, locale='es-ES', timezone_id='Europe/Madrid')
    q=d.new_page(); q.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    q.goto('http://localhost:8080/'); q.wait_for_timeout(500)
    q.evaluate("async()=>{}")
    # copiar config
    q.goto('http://localhost:8080/#/ajustes'); q.fill('#cfg-url','http://localhost:8787'); q.fill('#cfg-token','secreto'); q.click('text=Guardar y probar conexión'); q.wait_for_timeout(1500)
    q.goto('http://localhost:8080/#/'); q.wait_for_timeout(800); shot(q,'d-lista')
    q.click('[data-act=agrupar][data-v=etiqueta] >> nth=0'); q.wait_for_timeout(300); shot(q,'d-etiqueta')
    q.click('.n-main >> nth=0'); q.wait_for_timeout(400); shot(q,'d-editor')
    q.keyboard.press('Escape')
    # conflicto: editar en escritorio y en móvil con versión vieja
    nid=datos['notas'][0]['id']
    q.click(f'[data-act=abrir][data-id="{nid}"]'); q.fill('[data-ed=titulo]','Título desde el ordenador'); q.click('[data-act=ed-guardar]'); q.wait_for_timeout(1200)
    p.click(f'[data-act=abrir][data-id="{nid}"]'); p.fill('[data-ed=titulo]','Título desde el móvil'); p.click('[data-act=ed-guardar]'); p.wait_for_timeout(1500)
    shot(p,'m-conflicto-banner')
    p.goto('http://localhost:8080/#/conflicto'); p.wait_for_timeout(400); shot(p,'m-conflicto')
    p.click('[data-act=conf-mia]'); p.wait_for_timeout(1500)
    datos=p.evaluate("fetch('http://localhost:8787/datos',{headers:{Authorization:'Bearer secreto'}}).then(r=>r.json())")
    print('tras conflicto:', [n['titulo'] for n in datos['notas'] if n['id']==nid])
    # offline
    ctx.set_offline(True)
    p.goto('http://localhost:8080/#/nota/nueva') if False else None
    p.click('.bottombar >> text=Nueva nota'); p.fill('[data-ed=titulo]','Nota sin cobertura'); p.click('[data-act=ed-guardar]'); p.wait_for_timeout(800)
    print('estado offline:', p.inner_text('#sync'))
    shot(p,'m-offline')
    ctx.set_offline(False); p.evaluate("window.dispatchEvent(new Event('online'))"); p.wait_for_timeout(2000)
    print('estado online:', p.inner_text('#sync'))
    datos=p.evaluate("fetch('http://localhost:8787/datos',{headers:{Authorization:'Bearer secreto'}}).then(r=>r.json())")
    print('sin cobertura subida:', any(n['titulo']=='Nota sin cobertura' for n in datos['notas']))
    b.close()
print('ERRORES:', errs)
