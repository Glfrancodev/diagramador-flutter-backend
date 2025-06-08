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
const sizeOf = require('image-size').imageSize;
const { v4: uuidv4 } = require('uuid'); // ← asegúrate de tener esto
function estimateFontSize(boxHeightPx) {
  if (boxHeightPx < 12) return 9;
  if (boxHeightPx < 16) return 11;
  if (boxHeightPx < 22) return 13;
  if (boxHeightPx < 28) return 14;
  if (boxHeightPx < 34) return 16;
  if (boxHeightPx < 40) return 18;
  if (boxHeightPx < 46) return 20;
  if (boxHeightPx < 54) return 21;
  if (boxHeightPx < 60) return 23;
  return 23; // máximo estimado
}

const DETECTOR_SCHEMA = {
  name: 'detect_ui',
  description: 'Devuelve todos los componentes UI detectados en el boceto',
  parameters: {
    type: 'object',
    properties: {
      boxes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tipo', 'bb'],
          properties: {
            /* tipos válidos en tu editor */
            tipo: { enum: [
              'Label', 'InputBox', 'InputFecha', 'Boton',
              'Selector', 'Checkbox', 'Tabla', 'Link', 'Sidebar'
            ]},
            texto   : { type: 'string' },
            headers : { type: 'array',  items:{type:'string'} },
            filas   : { type: 'array',  items:{type:'array', items:{type:'string'}} },
            items   : { type: 'array',  items:{type:'object', properties:{texto:{type:'string'}}}},
            options : { type: 'array',  items:{type:'string'} },
            url     : { type: 'string' },
            bb: {
              type: 'object',
              required: ['x','y','w','h'],
              properties: {
                x:{type:'number'}, y:{type:'number'},
                w:{type:'number'}, h:{type:'number'}
              }
            }
          }
        }
      }
    },
    required: ['boxes']
  }
};

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
                                         'Size(414,896)';

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


async importarBoceto(req, res) {
  try {
    /* ─── 0. Validaciones ─── */
    if (!req.file)
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext))
      return res.status(400).json({ error: 'Formato no válido. Solo PNG o JPG.' });

    /* ─── 1. Imagen → base64 ─── */
    const rutaImg = req.file.path;
    const buffer  = await fs.readFile(rutaImg);
    const { width: W, height: H } = sizeOf(buffer);
    const base64URL =
      `data:image/${ext.replace('.', '')};base64,${buffer.toString('base64')}`;

    /* ─── 2. Prompt ─── */
const prompt = `
Eres un analista experto en mockups de interfaces, es decir, necesito que sepas describir de manera exacta y fiel el contenido de la imagen que te voy a mandar haciendo que tu respuesta sea completamente fiel al boceto de imagen.

INSTRUCCIONES GENERALES
• Usa TODO el marco de la imagen como canvas (sin márgenes).
• Devuelve CADA componente visible (Label, InputBox, InputFecha, Boton, Sidebar, etc.).
• Las coordenadas bb.x, bb.y, bb.w, bb.h deben estar en **píxeles absolutos**
  respecto al tamaño real de la imagen (${W}px × ${H}px).
• Si un Selector está desplegado (con varias opciones visibles), incluye esas opciones en props.options[].
• Si sólo una opción es visible incluye esa opción en props.options[].
SIDEBARS
• Si un Label cae completamente DENTRO del rectángulo del Sidebar:
  - El Label más alto será props.titulo.
  - El resto irán en props.items[].
• No devuelvas esos Label como elementos sueltos fuera del Sidebar.
SELECTOR DESPLEGADO
• Si detectas una caja con una opción visible y debajo aparecen una o más líneas de texto alineadas verticalmente, dentro de rectángulos del mismo ancho:
  - Interprétalo como un Selector desplegado.
  - Usa la opción visible como props.texto
  - Incluye TODAS las opciones visibles, incluyendo la seleccionada, en props.options[].
  - Usa las opciones listadas debajo como props.options[]
• No trates esas opciones como tabla ni como input.

FORMATO DE SALIDA
• Llama únicamente a la función detect_ui con el JSON correspondiente.
• No añadas ningún texto adicional fuera del JSON.
`;

    /* ─── 3. Llamada a OpenAI (reintento) ─── */
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let toolCall;
    for (let i = 0; i < 2; i++) {
      const completion = await openai.chat.completions.create({
        model: 'o3',
        tools: [{ type: 'function', function: DETECTOR_SCHEMA }],
        messages: [
          { role: 'system', content: 'Eres un analista experto en wireframes.' },
          { role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: base64URL } }
          ] }
        ],
        max_completion_tokens: 2048
      });
      toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) break;
    }
    if (!toolCall)
      return res.status(400).json({ error: 'No se pudo interpretar el boceto.' });

    /* ─── 4. Parseo bruto ─── */
    let { boxes } = JSON.parse(toolCall.function.arguments);
    if (!boxes?.length)
      return res.status(400).json({ error: 'No se detectaron componentes.' });

    /* ─── 5. Post-proceso de Sidebar ─── */
    for (const sb of boxes.filter(b => b.tipo === 'Sidebar')) {
      const sx = sb.bb.x, sy = sb.bb.y,
            sx2 = sx + sb.bb.w, sy2 = sy + sb.bb.h;

      const internos = boxes.filter(b =>
        b.tipo === 'Label' &&
        b.bb.x >= sx && (b.bb.x + b.bb.w) <= sx2 &&
        b.bb.y >= sy && (b.bb.y + b.bb.h) <= sy2
      );

      if (internos.length) {
        internos.sort((a, b) => a.bb.y - b.bb.y);
        const tituloLbl = internos.shift();
        sb.titulo = tituloLbl.texto.trim();
        sb.items  = internos.map(l => ({ texto: l.texto.trim() }));
        // eliminar labels absorbidos
        boxes = boxes.filter(b => !internos.includes(b) && b !== tituloLbl);
      } else if (sb.texto) {
        // Fallback: usar texto del propio objeto Sidebar
        sb.titulo = sb.texto.trim();
      }
    }

    /* ─── 6. Boxes → elementos canvas ─── */
    const elementos = boxes.map(b => {
      const x = +(b.bb.x / W).toFixed(6);
      const y = +(b.bb.y / H).toFixed(6);
      const width  = +(b.bb.w / W).toFixed(6);
      const height = +(b.bb.h / H).toFixed(6);

      const base = {
        id: uuidv4(),
        tipo: b.tipo,
        x, y, width, height,
        props: { fontSize: estimateFontSize(b.bb.h) }

      };

      switch (b.tipo) {
        case 'Label':
          Object.assign(base.props, { texto: b.texto || '', color: '#000000', bold: false });
          break;
        case 'InputBox':
        case 'InputFecha':
          base.props.placeholder = b.texto || '';
          break;
        case 'Boton':
          Object.assign(base.props, {
            texto: b.texto || 'Botón',
            color: '#007bff',
            textColor: '#ffffff',
            borderRadius: 4
          });
          break;
        case 'Checkbox':
          base.props.texto = b.texto || 'Opción';
          break;
        case 'Selector':
          base.props.options = b.options || ['Opción 1', 'Opción 2'];
          break;
        case 'Tabla':
          Object.assign(base.props, {
            headers: b.headers || [],
            data: b.filas || [],
            colWidths: (b.headers || []).map(() => 100)
          });
          break;
        case 'Link':
          Object.assign(base.props, {
            texto: b.texto || 'Ir',
            url: b.url || 'https://ejemplo.com',
            color: '#2563eb'
          });
          break;
        case 'Sidebar':
          Object.assign(base.props, {
            titulo : b.titulo || '(SIN_TÍTULO)',
            items  : (b.items || []).map(it => ({
              texto: it.texto,
              nombrePestana: 'Pantalla 1'
            })),
            visible: true
          });
          break;
      }
      return base;
    });
    // Guardar automáticamente al detectar boceto
    await proyectoService.crear({
      nombre: 'Nuevo proyecto desde boceto',
      dispositivo: 'phoneStandard',
      idUsuario: req.usuario.idUsuario,
      contenido: JSON.stringify({
        dispositivo: 'phoneStandard',
        pestañas: [{ id: 'tab1', name: 'Pantalla 1', elementos }],
        clases: [],
        relaciones: [],
        clavesPrimarias: {}
      })
    });

    /* ─── 7. Respuesta ─── */
    res.status(200).json({
      dispositivo: 'phoneStandard',
      pestañas: [{ id: 'tab1', name: 'Pantalla 1', elementos }],
      clases: [],
      relaciones: [],
      clavesPrimarias: {},
      raw: toolCall.function.arguments
    });

  } catch (err) {
    console.error('[importarBoceto] Error crítico:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Error interno al analizar el boceto.' });
  }
}
}
      
module.exports = new ProyectoController();
      