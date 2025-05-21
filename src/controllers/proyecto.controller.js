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
        const posWrap = (child) => `Positioned(
          left: ${x.toFixed(2)},
          top : ${y.toFixed(2)},
          width : ${width.toFixed(2)},
          height: ${height.toFixed(2)},
          child : ${child}
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
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              ${widgets}
              ${sidebar ? `
              /* ---------- Sidebar ---------- */
              AnimatedPositioned(
                duration: const Duration(milliseconds: 300),
                left: visible ? 0 : -${sidebarWidth},
                top: 0,
                width: ${sidebarWidth},
                height: ${sidebarHeight},
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
                left: visible ? ${sidebarWidthNum - 40} : 0,
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
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

    const rutaImagen = req.file.path;
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
      return res.status(400).json({ error: 'Formato no válido. Solo PNG o JPG.' });
    }

    const imagenBuffer = fsSync.readFileSync(rutaImagen);
    const imagenBase64 = imagenBuffer.toString('base64');
    const base64URL = `data:image/${extension.replace('.', '')};base64,${imagenBase64}`;

    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Analizar estructura de clases
    const promptEstructura = `
Analiza el boceto. Si representa un CRUD, responde exactamente así:

{
  "clases": [{ "nombre": "NombreClase", "atributos": [{ "nombre": "atributo" }] }],
  "llavesPrimarias": { "NombreClase": "id" },
  "relaciones": []
}`;

    const resEstr = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptEstructura },
            { type: 'image_url', image_url: { url: base64URL } }
          ]
        }
      ],
      max_tokens: 1000
    }, { headers });

    const match = resEstr.data.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
    if (!match) return res.status(400).json({ error: 'JSON de clases no encontrado' });

    let estructura = JSON.parse(match[0]);
    estructura.clases = estructura.clases.map(clase => {
      const nombres = clase.atributos.map(a => a.nombre);
      const pk = estructura.llavesPrimarias?.[clase.nombre];
      if (pk && !nombres.includes(pk)) {
        clase.atributos.unshift({ nombre: pk });
      }
      return clase;
    });

    const clase = estructura.clases[0];
    const nombreClase = clase?.nombre || 'Pantalla1';
    const pk = estructura.llavesPrimarias?.[nombreClase] || 'id';

    // 2. Detectar si hay tabla, botón o sidebar
    const promptExtras = `
Analiza la imagen del formulario. ¿Contiene un botón como "Agregar"? ¿Contiene una tabla? ¿Hay un menú lateral o sidebar?

Responde con este JSON:
{
  "boton": true/false,
  "textoBoton": "Agregar",
  "tabla": {
    "headers": ["id", "Nombre", "Apellido"],
    "filas": [
      ["1", "Hola", "Chau"],
      ["2", "Juan", "Perez"]
    ]
  } o null,
  "sidebar": {
    "titulo": "Menú",
    "items": [
      { "texto": "Usuario", "nombrePestana": "Usuario" }
    ]
  } o null
}`;

    const resExtras = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptExtras },
            { type: 'image_url', image_url: { url: base64URL } }
          ]
        }
      ],
      max_tokens: 1000
    }, { headers });

    let extras = { boton: false, tabla: null, sidebar: null };
    const matchExtras = resExtras.data.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
    if (matchExtras) {
      try {
        extras = JSON.parse(matchExtras[0]);
      } catch (err) {
        console.warn('⚠️ JSON inválido en elementos extras:', matchExtras[0]);
      }
    }

    // 3. Generar elementos
    const elementos = [];
    elementos.push({
      id: crypto.randomUUID(),
      tipo: 'Label',
      x: 60,
      y: 10,
      width: 300,
      height: 40,
      props: {
        texto: nombreClase,
        fontSize: 24,
        color: '#2563eb',
        bold: true
      }
    });

    let yActual = 60;
    clase.atributos.forEach(attr => {
      if (attr.nombre.toLowerCase() === pk.toLowerCase()) return;
      const esFecha = attr.nombre.toLowerCase().includes('fecha');
      const tipo = esFecha ? 'InputFecha' : 'InputBox';

      elementos.push({
        id: crypto.randomUUID(),
        tipo: 'Label',
        x: 50,
        y: yActual,
        width: 250,
        height: 20,
        props: {
          texto: attr.nombre,
          fontSize: 14,
          color: '#000000',
          bold: false
        }
      });

      yActual += 20;

      elementos.push({
        id: crypto.randomUUID(),
        tipo,
        x: 50,
        y: yActual,
        width: 250,
        height: 35,
        props: {
          placeholder: attr.nombre,
          fontSize: 16
        }
      });

      yActual += 50;
    });

    if (extras.boton) {
      elementos.push({
        id: crypto.randomUUID(),
        tipo: 'Boton',
        x: 50,
        y: yActual,
        width: 250,
        height: 40,
        props: {
          texto: extras.textoBoton || 'Agregar',
          color: '#007bff',
          textColor: '#ffffff',
          fontSize: 16,
          borderRadius: 6
        }
      });
      yActual += 60;
    }

    if (extras.tabla) {
      elementos.push({
        id: crypto.randomUUID(),
        tipo: 'Label',
        x: 50,
        y: yActual,
        width: 250,
        height: 20,
        props: {
          texto: 'Lista usuarios',
          fontSize: 14,
          color: '#000000',
          bold: false
        }
      });
      yActual += 30;

      elementos.push({
        id: crypto.randomUUID(),
        tipo: 'Tabla',
        x: 50,
        y: yActual,
        width: 320,
        height: 120,
        props: {
          headers: extras.tabla.headers,
          data: extras.tabla.filas,
          colWidths: extras.tabla.headers.map(() => 100),
          fontSize: 14
        }
      });

      yActual += 140;
    }

    if (extras.sidebar && extras.sidebar.items?.length > 0) {
      elementos.push({
        id: crypto.randomUUID(),
        tipo: 'Sidebar',
        x: 0,
        y: 0,
        width: 240,
        height: 1335,
        props: {
          titulo: extras.sidebar.titulo || 'Menú',
          items: extras.sidebar.items || [],
          visible: true
        }
      });
    }

    // 4. Crear proyecto y guardar
    const contenido = {
      dispositivo: 'phoneStandard',
      pestañas: [{
        id: 'tab1',
        name: nombreClase,
        elementos
      }],
      clases: estructura.clases,
      relaciones: estructura.relaciones || [],
      clavesPrimarias: estructura.llavesPrimarias || {}
    };

    const proyecto = await proyectoService.crear({
      nombre: nombreClase,
      descripcion: 'Importado desde boceto',
      idUsuario: req.usuario.idUsuario,
      contenido: JSON.stringify(contenido),
      creadoEn: new Date().toISOString()
    });

    res.status(201).json({
      mensaje: '✅ Boceto analizado y proyecto creado correctamente',
      proyecto
    });
  } catch (error) {
    console.error('[importarBoceto] Error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Error interno al analizar el boceto.' });
  }
}



}
      
module.exports = new ProyectoController();
      