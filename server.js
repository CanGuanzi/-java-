import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { AMapService } from './services/amapService.js';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import os from 'os';

const JWT_SECRET = 'route-planner-secret';

// 加载环境变量
dotenv.config();

// 导入服务
import { routeService } from './services/routeService.js';
const amapService = new AMapService(process.env.AMAP_API_KEY || '您的真实Web服务API_Key');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 创建上传目录
const uploadsDir = join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ 创建上传目录:', uploadsDir);
}

// 中间件
app.use(cors());


// 数据库文件路径
const dbPath = join(__dirname, 'data', 'routes.db');

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌❌ 数据库连接失败:', err.message);
    } else {
        console.log('✅ 数据库连接成功');
        // 创建用户表（如果不存在）
        db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
            if (err) {
                console.error('❌❌ 创建用户表失败:', err.message);
            } else {
                // 检查是否存在admin用户
                db.get('SELECT * FROM users WHERE username = "admin"', (err, user) => {
                    if (err) {
                        console.error('❌❌ 检查admin用户失败:', err.message);
                    } else if (!user) {
                        // 创建默认admin用户
                        const password = 'admin123';
                        bcrypt.hash(password, 10, (err, hash) => {
                            if (err) {
                                console.error('❌❌ 密码哈希失败:', err.message);
                            } else {
                                db.run(
                                    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
                                    ['admin', hash, 1],
                                    function (err) {
                                        if (err) {
                                            console.error('❌❌ 创建admin用户失败:', err.message);
                                        } else {
                                            console.log('✅ 已创建默认admin用户 (admin/admin123)');
                                        }
                                    }
                                );
                            }
                        });
                    }
                });
            }
        });
    }
});

// 从文档2导入的数据库功能
import {
    initDatabase,
    saveRouteToDB,
    getRoutesFromDB,
    getRouteByIdFromDB,
    updateRouteInDB,
    deleteRouteFromDB,
    getRouteStatsFromDB,
    getRouteMarkersFromDB,
    saveRouteMarkerToDB,
    updateRouteMarkerInDB,
    deleteRouteMarkerFromDB,
    testDatabaseSearch,
    searchRoutesFromDB,
    ensureAdminUser,
    createReadOnlyUsers
} from './models/database.js';

// 配置 multer 用于文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        cb(null, 'marker-' + uniqueSuffix + '.' + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传图片文件'));
        }
    }
});

app.use(express.static(join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// 中间件 - 管理员权限检查
function adminOnly(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: '未登录' });

    try {
        const token = auth.replace('Bearer ', '');
        const payload = jwt.verify(token, JWT_SECRET);

        if (!payload.is_admin) {
            return res.status(403).json({ message: '仅管理员可操作' });
        }

        req.user = payload;
        next();
    } catch {
        res.status(401).json({ message: '登录失效' });
    }
}

// 登录接口
app.post('/api/auth/login', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body;

        // 验证输入
        if (!username || !password) {
            return res.status(400).json({
                message: '用户名和密码不能为空'
            });
        }

        // 检查数据库连接
        if (!db) {
            console.error('❌❌ 数据库连接未初始化');
            return res.status(500).json({
                message: '服务器数据库未就绪，请联系管理员'
            });
        }

        // 使用Promise封装数据库查询
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });

        // 验证用户
        if (!user) {
            return res.status(401).json({
                message: '账号不存在'
            });
        }

        // 验证密码
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({
                message: '密码错误'
            });
        }

        // 生成令牌
        const token = jwt.sign({
            id: user.id,
            is_admin: user.is_admin
        }, JWT_SECRET, {
            expiresIn: '8h'
        });

        res.json({
            token,
            is_admin: user.is_admin,
            message: '登录成功'
        });

    } catch (error) {
        console.error('❌❌ 服务器错误:', error);
        res.status(500).json({
            message: '服务器内部错误',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: '✅ 服务正常运行',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        features: ['路径规划', '地理编码', '逆地理编码'],
        apiSource: '高德地图真实API'
    });
});

// 路径规划接口
app.post('/api/plan-route', adminOnly, express.json(), async (req, res) => {
    try {
        const { points, strategy = "0" } = req.body;

        console.log('🗺🗺️ 收到路径规划请求:', {
            points: points.length,
            strategy,
            timestamp: new Date().toISOString()
        });

        if (!points || points.length < 2) {
            return res.status(400).json({
                success: false,
                message: '至少需要起点和终点2个路径点'
            });
        }

        // 提取起点、终点、途径点
        const origin = { lng: points[0].lng, lat: points[0].lat };
        const destination = { lng: points[points.length - 1].lng, lat: points[points.length - 1].lat };
        const waypoints = points.slice(1, points.length - 1);

        console.log('📍 路径点信息:', {
            origin,
            destination,
            waypoints: waypoints.length
        });

        // 调用真实高德API
        const routeData = await amapService.planDrivingRoute(
            origin,
            destination,
            waypoints,
            strategy
        );

        console.log('✅ 路径规划成功:', {
            distance: routeData.distance,
            time: routeData.time,
            steps: routeData.steps.length
        });

        res.json({
            success: true,
            data: {
                ...routeData,
                points: points,
                calculatedAt: new Date().toISOString()
            },
            message: '路径规划完成（高德地图真实数据）'
        });

    } catch (error) {
        console.error('❌❌ 路径规划失败:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 地理编码接口（地址转坐标）
app.get('/api/geocode', async (req, res) => {
    try {
        const { address, city } = req.query;

        if (!address) {
            return res.status(400).json({
                success: false,
                message: '需要提供地址参数'
            });
        }

        const result = await routeService.geocodeAddress(address, city);
        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 逆地理编码接口（坐标转地址）
app.get('/api/reverse-geocode', async (req, res) => {
    try {
        const { lng, lat } = req.query;

        if (!lng || !lat) {
            return res.status(400).json({
                success: false,
                message: '需要提供经纬度参数'
            });
        }

        const result = await routeService.reverseGeocode(parseFloat(lng), parseFloat(lat));
        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 路线策略说明
app.get('/api/strategies', (req, res) => {
    res.json({
        success: true,
        data: {
            "0": "最快路线",
            "1": "最短路程",
            "2": "避开高速",
            "3": "不走高速",
            "4": "多策略（计算时间最短、距离最短、避开高速）",
            "5": "多策略（不考虑高速路）",
            "6": "避开收费",
            "7": "不走高速且避开收费",
            "8": "不走高速且躲避拥堵",
            "9": "躲避拥堵和收费",
            "10": "不走高速且躲避拥堵和收费"
        }
    });
});

// 静态文件服务
app.use(express.static(join(__dirname)));

// 首页
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>智能路线规划系统 - 真实API版</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
                code { background: #eee; padding: 2px 5px; }
            </style>
        </head>
        <body>
            <h1>🗺🗺️ 智能路线规划系统（真实高德API）</h1>
            <p>✅ 服务器运行正常 | 端口: ${PORT} | 数据源: 高德地图真实API</p>
            
            <div class="endpoint">
                <h3>📍 健康检查</h3>
                <p><code>GET</code> <a href="/api/health" target="_blank">/api/health</a></p>
            </div>
            
            <div class="endpoint">
                <h3>🛣🛣🛣️ 路径规划</h3>
                <p><code>POST</code> /api/plan-route</p>
                <p>Body: <code>{"points": [{"lng":116.397428,"lat":39.90923}, {"lng":116.407428,"lat":39.91923}]}</code></p>
            </div>
            
            <div class="endpoint">
                <h3>📫📫 地理编码</h3>
                <p><code>GET</code> <a href="/api/geocode?address=北京市海淀区上地十街10号" target="_blank">/api/geocode?address=地址</a></p>
            </div>
            
            <div class="endpoint">
                <h3>📍 逆地理编码</h3>
                <p><code>GET</code> <a href="/api/reverse-geocode?lng=116.397428&lat=39.90923" target="_blank">/api/reverse-geocode?lng=经度&lat=纬度</a></p>
            </div>
            
            <div class="endpoint">
                <h3>🎯🎯 路线策略</h3>
                <p><code>GET</code> <a href="/api/strategies" target="_blank">/api/strategies</a></p>
            </div>
            
            <h3>🚀🚀 快速测试</h3>
            <button onclick="testAPI()">测试所有接口</button>
            <div id="result"></div>
            
            <script>
                async function testAPI() {
                    const result = document.getElementById('result');
                    result.innerHTML = '<p>测试中...</p>';
                    
                    try {
                        // 测试健康检查
                        const health = await fetch('/api/health').then(r => r.json());
                        result.innerHTML += '<p>✅ 健康检查: ' + health.status + '</p>';
                        
                        // 测试路径规划
                        const plan = await fetch('/api/plan-route', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                points: [
                                    {lng: 116.397428, lat: 39.90923},
                                    {lng: 116.407428, lat: 39.91923}
                                ],
                                strategy: "0"
                            })
                        }).then(r => r.json());
                        
                        if (plan.success) {
                            result.innerHTML += '<p>✅ 路径规划: 成功 - 距离: ' + plan.data.distance + 'km, 时间: ' + plan.data.time + '分钟</p>';
                        } else {
                            result.innerHTML += '<p>❌❌ 路径规划: ' + plan.message + '</p>';
                        }
                        
                        // 测试地理编码
                        const geo = await fetch('/api/geocode?address=北京市海淀区上地十街10号').then(r => r.json());
                        if (geo.success) {
                            result.innerHTML += '<p>✅ 地理编码: 成功</p>';
                        }
                        
                    } catch (error) {
                        result.innerHTML += '<p style="color:red">❌❌ 测试失败: ' + error + '</p>';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// 测试接口
app.get('/api/test', (req, res) => {
    console.log('✅ /api/test 被访问了');
    res.json({ ok: true });
});

/* 图片上传接口*/
app.post('/api/upload-image', adminOnly, upload.single('image'), (req, res) => {
    console.log('🔥🔥🔥 命中 /api/upload-image');
    console.log('req.headers:', req.headers['content-type']);
    console.log('req.file:', req.file);
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: '没有文件被上传'
            });
        }

        // 返回图片的访问URL
        const imageUrl = `/uploads/${req.file.filename}`;

        console.log('✅ 图片上传成功:', {
            filename: req.file.filename,
            path: req.file.path,
            url: imageUrl,
            size: req.file.size
        });

        res.json({
            success: true,
            data: {
                imageUrl: imageUrl,
                filename: req.file.filename
            },
            message: '图片上传成功'
        });

    } catch (error) {
        console.error('❌❌ 图片上传失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});
app.post(
    '/api/routes/:routeId/markers',
    adminOnly,
    async (req, res) => {
        try {
            const { routeId } = req.params;

            if (!routeId || isNaN(routeId)) {
                return res.status(400).json({
                    success: false,
                    message: 'routeId 非法'
                });
            }

            const markerData = req.body;

            const savedMarker = await saveRouteMarkerToDB(
                Number(routeId),
                markerData
            );

            return res.json({
                success: true,
                data: savedMarker
            });

        } catch (error) {
            console.error('❌ 添加标记点失败:', error);
            return res.status(500).json({
                success: false,
                message: error.message || '服务器错误'
            });
        }
    }
);

// 路线相关接口
app.post('/api/routes', adminOnly, async (req, res) => {
    try {
        const routeData = req.body;

        console.log('💾💾💾💾 保存路线请求:', {
            name: routeData.name,
            points: routeData.waypoints ? JSON.parse(routeData.waypoints).length : 0,
            timestamp: new Date().toISOString()
        });

        const savedRoute = await saveRouteToDB(routeData);

        res.json({
            success: true,
            data: savedRoute,
            message: '路线保存成功'
        });

    } catch (error) {
        console.error('❌❌❌❌ 保存路线失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/routes', async (req, res) => {
    try {
        const { page, limit, type, search } = req.query;
        const filters = {
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 20,
            type: type || null,
            search: search || null
        };

        const routes = await getRoutesFromDB(filters);

        res.json({
            success: true,
            data: routes,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: routes.length
            }
        });

    } catch (error) {
        console.error('❌❌ 获取路线列表失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/routes/search', async (req, res) => {
    console.log('🔥🔥 真的命中 search 路由了');
    console.log('🔍🔍 收到搜索请求，查询参数:', req.query);

    try {
        const {
            keyword = '',
            city = '',
            district = '',
            routeType = '',
            creator = '',
            page = 1,
            limit = 20
        } = req.query;

        const filters = {
            keyword,
            city,
            district,
            routeType,
            creator,
            page: parseInt(page),
            limit: parseInt(limit)
        };

        console.log('📋📋 搜索过滤器:', filters);

        const result = await searchRoutesFromDB(filters);

        console.log(`✅ 搜索完成，找到 ${result.routes.length} 条记录`);

        res.json({
            success: true,
            data: result.routes,
            total: result.total,
            page: result.page,
            limit: result.limit
        });

    } catch (error) {
        console.error('❌❌ 搜索失败:', error);
        res.status(500).json({
            success: false,
            message: error.message || '搜索失败'
        });
    }
});

app.get('/api/routes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const route = await getRouteByIdFromDB(parseInt(id));

        res.json({
            success: true,
            data: route
        });

    } catch (error) {
        console.error('❌❌ 获取路线失败:', error);
        res.status(404).json({
            success: false,
            message: error.message
        });
    }
});

app.put('/api/routes/:id', adminOnly, express.json(), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        console.log('💾💾💾💾 更新路线请求 ID:', id, '数据:', updates);

        const result = await updateRouteInDB(parseInt(id), updates);

        res.json({
            success: true,
            data: result,
            message: '路线更新成功'
        });

    } catch (error) {
        console.error('❌❌❌❌ 更新路线失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.delete('/api/routes/:id', adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await deleteRouteFromDB(parseInt(id));

        res.json({
            success: true,
            data: result,
            message: '路线删除成功'
        });

    } catch (error) {
        console.error('❌❌ 删除路线失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/routes-stats', async (req, res) => {
    try {
        const stats = await getRouteStatsFromDB();

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('❌❌ 获取统计信息失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 标记点相关接口
app.get('/api/routes/:routeId/markers', async (req, res) => {
    try {
        const { routeId } = req.params;
        const markers = await getRouteMarkersFromDB(parseInt(routeId));

        res.json({
            success: true,
            data: markers
        });

    } catch (error) {
        console.error('❌❌❌❌ 获取标记点失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});



app.put('/api/markers/:markerId', adminOnly, express.json(), async (req, res) => {
    try {
        const { markerId } = req.params;
        const updates = req.body;

        const result = await updateRouteMarkerInDB(parseInt(markerId), updates);

        res.json({
            success: true,
            data: result,
            message: '标记点更新成功'
        });

    } catch (error) {
        console.error('❌❌❌❌ 更新标记点失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.delete('/api/markers/:markerId', adminOnly, async (req, res) => {
    try {
        const { markerId } = req.params;
        const result = await deleteRouteMarkerFromDB(parseInt(markerId));

        res.json({
            success: true,
            data: result,
            message: '标记点删除成功'
        });

    } catch (error) {
        console.error('❌❌❌❌ 删除标记点失败:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 静态文件服务，用于访问上传的图片
app.use('/uploads', express.static(join(__dirname, 'public', 'uploads')));

//// 启动服务器
//initDatabase()
//    .then(() => {
//        console.log('🗄🗄️ 数据库初始化完成');

//        // 移除 async 关键字
//        app.listen(PORT, '0.0.0.0', () => {
//            console.log('🚀🚀 智能路线规划系统启动成功!');
//            console.log('📍 本地访问: http://localhost:' + PORT);
//            console.log('🌐 网络访问:');

//            // 显示所有IP地址
//            const interfaces = os.networkInterfaces();

//            Object.keys(interfaces).forEach(iface => {
//                interfaces[iface].forEach(alias => {
//                    if (alias.family === 'IPv4' && !alias.internal) {
//                        console.log(`  http://${alias.address}:${PORT}`);
//                    }
//                });
//            });

//            console.log('🗺🗺️ 数据源: 高德地图真实API');
//            console.log('📊📊 健康检查: http://localhost:' + PORT + '/api/health');

//            // 将异步操作移到外面，用 then/catch 处理
    //        testDatabaseSearch()
    //            .then(() => console.log('✅ 数据库测试完成'))
    //            .catch(error => console.error('❌❌ 数据库测试失败:', error));
    //    });
    //})
    //.catch(err => {
    //    console.error('❌❌ 数据库初始化失败，服务未启动:', err);
    //});
initDatabase()
    .then(() => {
        console.log('🗄 数据库初始化完成');

        const HOST = '0.0.0.0';
        const PORT = process.env.PORT || 3001;

        // 🔥 强制打印准备绑定的信息
        console.log('🚀 准备启动服务器...');
        console.log('📡 HOST:', HOST);
        console.log('🔧 PORT:', PORT);
        console.log('🌐 正在绑定到 %s:%d', HOST, PORT);

        const server = app.listen(PORT, HOST, () => {
            console.log('✅ 成功启动！访问地址：');

            const interfaces = os.networkInterfaces();
            Object.keys(interfaces).forEach(iface => {
                interfaces[iface].forEach(alias => {
                    if (alias.family === 'IPv4' && !alias.internal) {
                        console.log(`   http://${alias.address}:${PORT}`);
                    }
                });
            });

            console.log('📍 本地访问: http://localhost:%d', PORT);
            console.log('🗺 数据源: 高德地图真实API');
        });

        // 💡 添加错误监听
        server.on('error', (err) => {
            console.error('❌ 服务器启动失败:', err.message);
            if (err.code === 'EADDRINUSE') {
                console.error('⛔ 端口 %d 已被占用，请关闭其他程序', PORT);
            } else if (err.code === 'EACCES') {
                console.error('⛔ 权限不足，无法绑定到该端口');
            }
        });

        // 🔍 主动测试数据库搜索
        testDatabaseSearch()
            .then(() => console.log('✅ 数据库测试完成'))
            .catch(error => console.error('❌ 数据库测试失败:', error));
    })
    .catch(err => {
        console.error('❌❌ 数据库初始化失败:', err);
    });
// 添加正确的调试接口
app.post('/api/debug/create-readonly', async (req, res) => {
    try {
        console.log('🔧 手动创建只读用户...');

        const result = await createReadOnlyUsers();

        res.json({
            success: true,
            message: `创建完成: 成功 ${result.created} 个，失败 ${result.errors} 个`,
            data: result
        });
    } catch (error) {
        console.error('❌ 创建只读用户接口错误:', error);
        res.status(500).json({
            success: false,
            message: '创建失败: ' + error.message
        });
    }
});

// 添加查看用户的接口
app.get('/api/debug/users', (req, res) => {
    db.all('SELECT id, username, is_admin, created_at FROM users', (err, rows) => {
        if (err) {
            console.error('❌ 查询用户失败:', err);
            res.status(500).json({ error: err.message });
        } else {
            console.log('📊 数据库中的用户数量:', rows.length);
            res.json(rows);
        }
    });
});

// 检查API Key配置
if (!process.env.AMAP_API_KEY || process.env.AMAP_API_KEY === '您的默认API_Key') {
    console.warn('⚠️  警告: 请设置正确的高德API Key');
} else {
    console.log('✅ API Key配置正常');
}

export { db };