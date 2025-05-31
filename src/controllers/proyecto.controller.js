const fs = require('fs').promises;
const { OpenAI } = require('openai');
const axios = require('axios');
const fsSync = require('fs'); // <- nuevo alias para funciones síncronas como readFileSync
const fsExtra = require('fs-extra');
const archiver = require('archiver');
const path = require('path');
const { createWriteStream, rmSync, unlinkSync } = require('fs');
const proyectoService = require('../services/proyecto.service');
const crypto = require('crypto');


class ProyectoController {
  async crear(req, res) {
    try {
      const contenidoRecibido = JSON.parse(req.body.contenido || '{}');
  
      const contenidoConEstructura = {
        pestañas: contenidoRecibido.pestañas || [],
        clases: contenidoRecibido.clases || [],
        relaciones: contenidoRecibido.relaciones || [],
        clavesPrimarias: contenidoRecibido.clavesPrimarias || {}
      };
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
  
      const data = {
        ...req.body,
        idUsuario: req.usuario.idUsuario,
        contenido: JSON.stringify(contenidoConEstructura)
      };
  
      const proyecto = await proyectoService.crear(data);
      res.status(201).json(proyecto);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
  

  async listar(req, res) {
    const proyectos = await proyectoService.listar();
    res.json(proyectos);
  }

  async listarPorUsuario(req, res) {
    const proyectos = await proyectoService.listarPorUsuario(req.usuario.idUsuario);
    res.json(proyectos);
  }

  async obtener(req, res) {
    try {
      const proyecto = await proyectoService.obtenerPorId(req.params.id);
      res.json(proyecto);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async actualizar(req, res) {
    try {
      const contenidoRecibido = JSON.parse(req.body.contenido || '{}');

      // Normalizamos si faltan
      if (!Array.isArray(contenidoRecibido.pestañas)) {
        contenidoRecibido.pestañas = [];
      }
      if (!Array.isArray(contenidoRecibido.clases)) {
        contenidoRecibido.clases = [];
      }
      if (!Array.isArray(contenidoRecibido.relaciones)) {
        contenidoRecibido.relaciones = [];
      }
      if (typeof contenidoRecibido.clavesPrimarias !== 'object' || contenidoRecibido.clavesPrimarias === null) {
        contenidoRecibido.clavesPrimarias = {};
      }

      const dataActualizada = {
        contenido: JSON.stringify(contenidoRecibido),
      };

      const proyecto = await proyectoService.actualizar(req.params.id, req.usuario.idUsuario, dataActualizada);
      res.json(proyecto);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  

  async eliminar(req, res) {
    try {
      const resultado = await proyectoService.eliminar(req.params.id, req.usuario.idUsuario);
      res.json(resultado);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async listarPermitidos(req, res) {
    try {
      const proyectos = await proyectoService.listarProyectosPermitidos(req.usuario.idUsuario);
      res.json(proyectos);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listarInvitados(req, res) {
    try {
      const proyectos = await proyectoService.listarProyectosInvitado(req.usuario.idUsuario);
      res.json(proyectos);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  /* ----------------- EXPORTAR FLUTTER DINÁMICO ----------------- */
async exportarProyectoFlutter(req, res) {
  try {
    /* ---------- Paths y preparación de carpetas ---------- */
    const idProyecto = req.params.id;
    if (!idProyecto) return res.status(400).json({ error: 'Falta :id' });

    const plantillaDir = path.join(__dirname, '..', 'exportables', 'flutter-template');
    const tempDir     = path.join(__dirname, '..', 'temp', idProyecto);
    const zipPath     = path.join(__dirname, '..', 'temp', `${idProyecto}.zip`);

    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    try { unlinkSync(zipPath); } catch {}

    await fsExtra.copy(plantillaDir, tempDir, {
      filter: (src) => {
        const rel = path.relative(plantillaDir, src);
        const ign = ['.dart_tool', '.gradle', '.idea', 'build', 'android/.gradle'];
        return !ign.some((c) => rel === c || rel.startsWith(`${c}${path.sep}`));
      },
    });

    /* ---------- Carga de datos ---------- */
    const proyectoDB = await proyectoService.obtenerPorId(idProyecto);
    if (!proyectoDB) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const contenido   = JSON.parse(proyectoDB.contenido || '{}');
    const pestañas    = contenido.pestañas   || [];
    const dispositivo = contenido.dispositivo || 'tablet';
    if (!pestañas.length) return res.status(400).json({ error: 'El proyecto no posee pestañas' });

    const libDir     = path.join(tempDir, 'lib');
    const screensDir = path.join(libDir,  'screens');
    await fs.mkdir(screensDir, { recursive: true });

    /* ---------- Aux ---------- */
    const normalizarNombre = (nombre) => {
      const limpio = nombre.trim().replace(/\s+/g, ' ');
      const camel  = limpio.replace(/(^\w|\s\w)/g, (m) => m.toUpperCase()).replace(/\s/g, '');
      return {
        clase: `Pantalla${camel}`,
        file : `pantalla_${limpio.toLowerCase().replace(/\s+/g, '')}.dart`,
        ruta : `/${camel}`,
      };
    };

    /* =======================================================
       ==========   GENERACIÓN DE CADA PANTALLA   ============
       ======================================================= */
    for (const pest of pestañas) {
      /* --- set para widgets auxiliares de ESTA pantalla --- */
      const auxWidgets = new Set();

      /* --- función que crea cada widget individual --- */
      const generarWidget = (el) => {
        const { tipo, x, y, width, height, props } = el;
        const posWrap = (child) => `
          Positioned(
            left: constraints.maxWidth * ${x.toFixed(4)},
            top: constraints.maxHeight * ${y.toFixed(4)},
            width: constraints.maxWidth * ${width.toFixed(4)},
            height: constraints.maxHeight * ${height.toFixed(4)},
            child: ${child}
          ),`;


        switch (tipo) {
          /* ---------- BOTÓN ---------- */
          case 'Boton':
            return posWrap(`ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: Color(0xFF${(props.color || '#007bff').slice(1)}),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(${props.borderRadius ?? 4})
                )
              ),
              child: Align(
                alignment: Alignment.center,
                child: Text(
                  '${props.texto}',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: ${props.fontSize},
                    color: Color(0xFF${(props.textColor || '#ffffff').slice(1)})
                  )
                ),
              )
            )`);
          /* ---------- LABEL ---------- */
          case 'Label':
            return posWrap(`Text(
              '${props.texto}',
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: ${props.fontSize},
                fontWeight: ${props.bold ? 'FontWeight.bold' : 'FontWeight.normal'},
                color: Color(0xFF${(props.color || '#000000').slice(1)})
              )
            )`);
          /* ---------- INPUTBOX ---------- */
          case 'InputBox':
            return posWrap(`TextField(
              decoration: InputDecoration(
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                border: OutlineInputBorder(),
                hintText: '${props.placeholder ?? ''}',
              ),
              style: TextStyle(fontSize: ${props.fontSize}),
            )`);
          /* ---------- INPUTFECHA ---------- */
          case 'InputFecha': {
            const id = `inputfecha_${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            auxWidgets.add(`
          class _InputFechaWidget_${id} extends StatefulWidget {
            const _InputFechaWidget_${id}({super.key});
            @override
            State<_InputFechaWidget_${id}> createState() => _InputFechaWidgetState_${id}();
          }
          class _InputFechaWidgetState_${id} extends State<_InputFechaWidget_${id}> {
            DateTime? selectedDate;
            final TextEditingController controller = TextEditingController();

            Future<void> _selectDate(BuildContext context) async {
              final DateTime? picked = await showDatePicker(
                context: context,
                initialDate: selectedDate ?? DateTime.now(),
                firstDate: DateTime(1900),
                lastDate: DateTime(2100),
              );
              if (picked != null && picked != selectedDate) {
                setState(() {
                  selectedDate = picked;
                  controller.text = "\${picked.toLocal()}".split(' ')[0];
                });
              }
            }

            @override
            Widget build(BuildContext context) {
              return TextField(
                controller: controller,
                readOnly: true,
                onTap: () => _selectDate(context),
                decoration: const InputDecoration(
                  hintText: 'dd/mm/aaaa',
                  suffixIcon: Icon(Icons.calendar_today_outlined, size: 20),
                  border: OutlineInputBorder(),
                  contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                ),

                style: TextStyle(fontSize: ${props.fontSize}),
              );
            }
          }
            `);
            return posWrap(`_InputFechaWidget_${id}()`);
          }
          /* ---------- SELECTOR ---------- */
          case 'Selector': {
            const opciones = JSON.stringify(props.options);
            const id = `dropdown_${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            auxWidgets.add(`
      class _DropdownWidget_${id} extends StatefulWidget {
        @override
        State<_DropdownWidget_${id}> createState() => _DropdownWidgetState_${id}();
      }
      class _DropdownWidgetState_${id} extends State<_DropdownWidget_${id}> {
        String? val = '${props.options[0]}';

        @override
        Widget build(BuildContext context) {
          return Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: DropdownButton<String>(
              isExpanded: true,
              value: val,
              underline: const SizedBox.shrink(),
              style: TextStyle(
                fontSize: ${props.fontSize},
                color: Colors.black,
              ),
              dropdownColor: Colors.white,
              items: ${opciones}.map<DropdownMenuItem<String>>(
                (o) => DropdownMenuItem(
                  value: o,
                  child: Center(
                    child: Text(
                      o,
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  )
                )
              ).toList(),
              onChanged: (v) => setState(() => val = v),
            ),
          );
        }
      }
            `);
            return posWrap(`_DropdownWidget_${id}()`);
          }

          /* ---------- CHECKBOX ---------- */
          case 'Checkbox':
            if (![...auxWidgets].some((c) => c.includes('class _CheckboxWidget'))) {
              auxWidgets.add(`
      class _CheckboxWidget extends StatefulWidget {
        final String texto;
        final double fontSize;
        const _CheckboxWidget({required this.texto, required this.fontSize});
        @override
        State<_CheckboxWidget> createState() => _CheckboxWidgetState();
      }
      class _CheckboxWidgetState extends State<_CheckboxWidget> {
        bool value = false;
        @override
        Widget build(BuildContext context) {
          return Container(
            alignment: Alignment.centerLeft,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Checkbox(
                  value: value,
                  onChanged: (v) => setState(() => value = v!),
                ),
                Expanded(
                  child: Container(
                    alignment: Alignment.centerLeft,
                    constraints: const BoxConstraints(minWidth: 0),
                    child: Text(
                      widget.texto,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: widget.fontSize),
                    ),
                  ),
                )
              ],
            ),
          );
        }
      }
              `);
            }
            return posWrap(`_CheckboxWidget(
              texto: '${props.texto}',
              fontSize: ${props.fontSize}
            )`);


          /* ---------- LINK ---------- */
          case 'Link':
          return posWrap(`GestureDetector(
            onTap: () async {
              final uri = Uri.parse('${props.url}');
              if (await canLaunchUrl(uri)) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              }
            },
            child: Text('${props.texto}',
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                decoration: TextDecoration.underline,
                fontSize: ${props.fontSize},
                color: Color(0xFF${(props.color || '#2563eb').slice(1)})
              )
            ),
          )`);
          /* ---------- TABLA ---------- */
          case 'Tabla': {
            const encabezado = props.headers.map(
              (h, i) => `
                TableCell(
                  child: Container(
                    width: ${props.colWidths[i]},
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Color(0xFFe5e7eb),
                      border: Border.all(color: Colors.grey),
                    ),
                    child: Text(
                      '${h}',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: ${props.fontSize}
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  )
                )
            `).join(',');

            const filas = props.data.map(
              (fila) => `
                TableRow(children: [
                  ${fila.map(
                    (c, i) => `
                      TableCell(
                        child: Container(
                          width: ${props.colWidths[i]},
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            border: Border.all(color: Colors.grey),
                          ),
                          child: Text(
                            '${c}',
                            style: TextStyle(fontSize: ${props.fontSize}),
                            overflow: TextOverflow.ellipsis,
                          ),
                        )
                      )
                  `).join(',')}
                ])
            `).join(',');

            return posWrap(`
              SizedBox(
                width: ${width.toFixed(2)},
                height: ${height.toFixed(2)},
                child: Scrollbar(
                  thumbVisibility: true,
                  child: SingleChildScrollView(
                    scrollDirection: Axis.vertical,
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Table(
                        defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                        columnWidths: {
                          ${props.colWidths.map((w, i) => `${i}: FixedColumnWidth(${w})`).join(',')}
                        },
                        children: [
                          TableRow(children: [${encabezado}]),
                          ${filas}
                        ],
                      ),
                    ),
                  ),
                ),
              )
            `);
          }


          default:
            return posWrap('SizedBox.shrink()');
        }
      };

      /* ---------- Variables de pantalla ---------- */
      const { clase, file } = normalizarNombre(pest.name);
      const canvasSize =
        dispositivo === 'tablet'       ? 'Size(800,1335)' :
        dispositivo === 'mobile-small' ? 'Size(360,640)' :
                                         'Size(390,844)';

      const widgets = pest.elementos
        .filter((e) => e.tipo !== 'Sidebar')
        .map(generarWidget)
        .join('\n              ');

      const sidebar = pest.elementos.find((e) => e.tipo === 'Sidebar');
      const items = sidebar?.props?.items?.map((it) => `
              Container(
                margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF374151),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: ListTile(
                  dense: true,
                  title: Text('${it.texto}', style: const TextStyle(color: Colors.white)),
                  onTap: () => Navigator.pushReplacementNamed(
                    context, '/${it.nombrePestana.replace(/\s+/g, '')}'),
                ),
              ),`).join('') || '';

      const sidebarWidth     = sidebar?.width?.toFixed(2) || '200';
      const sidebarHeight    = sidebar?.height?.toFixed(2) || canvasSize.split(',')[1];
      const visibleDefault   = sidebar?.props?.visible !== false;
      const sidebarWidthNum  = parseFloat(sidebar?.width) || 200;

      /* ---------- Código final .dart de la pantalla ---------- */
      const pantallaCode = `
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/* ==== Widgets auxiliares generados ==== */
${[...auxWidgets].join('\n\n')}

class ${clase} extends StatefulWidget {
  @override
  State<${clase}> createState() => _${clase}State();
}

class _${clase}State extends State<${clase}> {
  bool visible = ${visibleDefault};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SizedBox(
          width: ${canvasSize}.width,
          height: ${canvasSize}.height,
          child: LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  ${widgets}
                  ${sidebar ? `
                  /* ---------- Sidebar ---------- */
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 300),
                    left: visible ? 0 : -constraints.maxWidth * ${sidebar.width.toFixed(4)},
                    top: 0,
                    width: constraints.maxWidth * ${sidebar.width.toFixed(4)},
                    height: constraints.maxHeight * ${sidebar.height.toFixed(4)},
                    child: Material(
                      elevation: 8,
                      color: const Color(0xFF1f2937),
                      child: Padding(
                        padding: const EdgeInsets.only(top: 16, left: 8, right: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${sidebar.props.titulo}',
                                style: const TextStyle(color: Colors.white, fontSize: 18)),
                            const SizedBox(height: 12),
                            Expanded(child: ListView(children: [${items}]))
                          ],
                        ),
                      ),
                    ),
                  ),

                  /* ---------- Botón toggle ---------- */
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 300),
                    left: visible
                      ? constraints.maxWidth * ${sidebar.width.toFixed(4)} - 40
                      : 0,
                    top: 16,
                    child: GestureDetector(
                      onTap: () => setState(() => visible = !visible),
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: const Color(0xFF2563eb),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Icon(Icons.menu, color: Colors.white, size: 20),
                      ),
                    ),
                  ),` : ''}
                ],
              );
            }
          ),

        ),
      ),
    );
  }
}
      `;
      await fs.writeFile(path.join(screensDir, file), pantallaCode);
    } /* fin for de pestañas */

    /* ---------- main.dart ---------- */
    const imports = pestañas
      .map((p) => `import 'screens/${normalizarNombre(p.name).file}';`)
      .join('\n');
    const rutas = pestañas
      .map((p) => {
        const { ruta, clase } = normalizarNombre(p.name);
        return `'${ruta}': (context) => ${clase}(),`;
      })
      .join('\n        ');
    const homeClase = normalizarNombre(pestañas[0].name).clase;

    const mainCode = `
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
${imports}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: []);
  runApp(const MyApp());
}


class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Proyecto exportado',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true),
      home: ${homeClase}(),
      routes: {
        ${rutas}
      },
    );
  }
}
`;
    await fs.writeFile(path.join(libDir, 'main.dart'), mainCode);

    /* ---------- ZIP y descarga ---------- */
    const output  = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[EXPORTAR] ZIP:', err);
      return res.status(500).json({ error: 'Error al crear ZIP' });
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();

    await new Promise((ok, err) => {
      output.on('close', ok);
      output.on('error', err);
    });

    res.download(zipPath, `${proyectoDB.nombre}.zip`, (err) => {
      if (err) console.error('[EXPORTAR] envío:', err);
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      try { unlinkSync(zipPath); } catch {}
    });
  } catch (error) {
    console.error('[EXPORTAR] Error general:', error);
    res.status(500).json({ error: 'No se pudo exportar el proyecto Flutter.' });
  }
}

/**
 * POST /api/proyectos/importar-boceto
 * multipart/form-data:
 *   – imagen            (file .png / .jpg)
 *   – tipoDispositivo   (text) phoneSmall | phoneStandard | tablet
 *
 * ⇢ Crea SIEMPRE un proyecto visual (canvas) a partir del boceto,
 *   sin importar si dibujaron un CRUD o un simple mock-up.
 * ⇢ No genera clases, atributos ni claves primarias.
 */
async importarBoceto(req, res) {
  try {
    /* ---------- 0. Validaciones ---------- */
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    const tipoDispositivo = req.body.tipoDispositivo || 'phoneStandard';
    const rutaImagen      = req.file.path;
    const ext             = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
      return res.status(400).json({ error: 'Formato no válido. Solo PNG o JPG.' });
    }

    /* ---------- 1. Imagen → base64 ---------- */
    const base64URL =
      `data:image/${ext.replace('.', '')};base64,${fsSync.readFileSync(rutaImagen).toString('base64')}`;

    /* ---------- 2. Obtener TODAS las bounding-boxes ---------- */
    const promptBoxes = `
Devuélveme todos los componentes reconocibles del boceto
(labels, inputs, botones, tablas, sidebars …) con sus bounding-boxes
normalizadas (0-1) respecto al ancho/alto de la imagen.

Formato exacto:
{
  "boxes": [
    { "tipo":"Label",     "texto":"Título",  "bb":{"x":0.05,"y":0.05,"w":0.9,"h":0.08} },
    { "tipo":"InputBox",  "texto":"Nombre",  "bb":{"x":0.25,"y":0.20,"w":0.65,"h":0.06} },
    { "tipo":"Boton",     "texto":"Enviar",  "bb":{"x":0.2,"y":0.35,"w":0.6,"h":0.07} },
    { "tipo":"Tabla",     "headers":["id","Nombre"], "filas":[["1","Juan"]], "bb":{...} },
    { "tipo":"Sidebar",   "texto":"Menú", "items":[{"texto":"Home"}], "bb":{...} }
  ]
}`;
    const resBB = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          { role: 'user',
            content: [
              { type: 'text', text: promptBoxes },
              { type: 'image_url', image_url: { url: base64URL } }
            ]
          }
        ],
        max_tokens: 1500
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const matchBB = resBB.data.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
    if (!matchBB) {
      return res.status(400).json({ error: 'No se pudo interpretar el boceto.' });
    }

    const { boxes } = JSON.parse(matchBB[0]);

    /* ---------- 3. Detectar pares Label + Input en línea ---------- */
    const labels = boxes.filter(b => b.tipo === 'Label');
    const inputs = boxes.filter(b => b.tipo.startsWith('Input'));
    const inlinePairs = {};         // textoLower → {label,input}

    inputs.forEach(inp => {
      const cand = labels
        .filter(l =>
          Math.abs(l.bb.y - inp.bb.y) < l.bb.h * 0.3 &&
          (l.bb.x + l.bb.w / 2) < (inp.bb.x + inp.bb.w / 2))
        .sort((a, b) => Math.abs(a.bb.y - inp.bb.y) - Math.abs(b.bb.y - inp.bb.y))[0];
      if (cand) inlinePairs[cand.texto?.toLowerCase()] = { label: cand, input: inp };
    });

    /* ---------- 4. Nombre de la pantalla ---------- */
    const tituloLabel = labels.sort((a, b) => b.bb.h - a.bb.h)[0];
    const nombrePantalla = tituloLabel?.texto?.trim() || 'Pantalla1';

    /* ---------- 5. Conversión a elementos del canvas ---------- */
    const DEVICE_W = { phoneSmall: 320, phoneStandard: 390, tablet: 768 }[tipoDispositivo] || 390;
    const elementos = [];

    const pushElement = (b, override = {}) => {
      const x      = Math.round(b.bb.x * DEVICE_W);
      const y      = Math.round(b.bb.y * DEVICE_W);
      const width  = Math.round(b.bb.w * DEVICE_W);
      const height = Math.round(b.bb.h * DEVICE_W);

      switch (b.tipo) {
        case 'InputBox':
        case 'InputFecha':
          elementos.push({
            id: crypto.randomUUID(), tipo: b.tipo, x, y, width, height,
            props: { placeholder: b.texto || '', fontSize: 16, ...override }
          }); break;
        case 'Boton':
          elementos.push({
            id: crypto.randomUUID(), tipo: 'Boton', x, y, width, height,
            props: { texto: b.texto || 'Botón', color:'#2563eb', textColor:'#fff', fontSize:16, ...override }
          }); break;
        case 'Tabla':
          elementos.push({
            id: crypto.randomUUID(), tipo:'Tabla', x, y, width, height,
            props:{ headers:b.headers||[], data:b.filas||[],
              colWidths:(b.headers||[]).map(()=>Math.floor(width/(b.headers||[]).length)),
              fontSize:14, ...override }
          }); break;
        case 'Sidebar':
          elementos.push({
            id: crypto.randomUUID(), tipo:'Sidebar', x, y, width, height,
            props:{ titulo:b.texto||'Menú', items:b.items||[], visible:true, ...override }
          }); break;
            default: // Label
              elementos.push({
                id: crypto.randomUUID(), tipo: 'Label', x, y, width, height,
                props: {
                  texto: b.texto || '',
                  fontSize: Math.max(10, Math.round(height * 0.8)), // estimación real basada en altura
                  color: '#000',
                  ...override
                }
              });

      }
    };

    // Boxes que NO pertenecen a un par inline
    boxes.forEach(b => {
      if (inlinePairs[b.texto?.toLowerCase()]?.label === b) return;
      if (inlinePairs[b.texto?.toLowerCase()]?.input === b) return;
      pushElement(b);
    });

    // Añadir pares inline (label + input)
    Object.values(inlinePairs).forEach(({ label, input }) => {
      pushElement(label, { valign:'middle' });
      pushElement(input);
    });

    /* ---------- 6. Guardar proyecto ---------- */
    const contenido = {
      dispositivo: tipoDispositivo,
      pestañas: [{ id:'tab1', name: nombrePantalla, elementos }],
      clases: [],               // SIN CRUD
      relaciones: [],
      clavesPrimarias: {}
    };

    const proyecto = await proyectoService.crear({
      nombre: nombrePantalla,
      descripcion: 'Importado desde boceto de diseño',
      idUsuario: req.usuario.idUsuario,
      contenido: JSON.stringify(contenido),
      creadoEn: new Date().toISOString()
    });

    return res.status(201).json({
      mensaje: '✅ Boceto analizado y proyecto creado correctamente',
      proyecto
    });

  } catch (err) {
    console.error('[importarBoceto] Error:', err?.response?.data || err.message);
    return res.status(500).json({ error: 'Error interno al analizar el boceto.' });
  }
}

}
      
module.exports = new ProyectoController();
      