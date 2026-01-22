import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 使用 process.env.DB_PATH 或默认路径
const DB_PATH = join(__dirname, '..', 'data', 'routes.db');

let db;

function connectDatabase() {
    return new Promise((resolve, reject) => {
        // 确保数据目录存在
        const dir = dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log('✅ 创建数据目录:', dir);
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌❌ 数据库连接失败:', err.message);
                reject(err);
            } else {
                console.log('✅ 连接至 SQLite 数据库:', DB_PATH);
                resolve(db);
            }
        });
    });
}

// 初始化数据库
export function initDatabase() {
    return new Promise(async (resolve, reject) => {
        try {
            await connectDatabase();
            console.log('🔌 数据库连接成功');

            await createTables();
            console.log('🏗️ 所有数据表初始化完成');

            await ensureAdminUser();
            console.log('🛡️ 默认用户初始化完成');

            resolve();
        } catch (error) {
            console.error('❌ 初始化失败:', error);
            reject(error);
        }
    });
}

// 创建数据表 (确保包含 FUN-004 的所有新字段)
function createTables() {
    return new Promise((resolve, reject) => {
        const createRoutesTable = `
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                route_type TEXT DEFAULT 'driving',
                city TEXT,
                district TEXT,
                district_type TEXT,
                intersections INTEGER DEFAULT 0,
                right_turns INTEGER DEFAULT 0,
                left_turns INTEGER DEFAULT 0,
                u_turns INTEGER DEFAULT 0,
                roundabouts INTEGER DEFAULT 0,
                special_traffic_lights INTEGER DEFAULT 0,
                special_intersections INTEGER DEFAULT 0,
                start_lng REAL NOT NULL,
                start_lat REAL NOT NULL,
                end_lng REAL NOT NULL,
                end_lat REAL NOT NULL,
                waypoints TEXT,
                distance REAL,
                duration INTEGER,
                polyline TEXT,
                steps TEXT,
                tolls REAL DEFAULT 0,
                traffic_lights INTEGER DEFAULT 0,
                created_by TEXT DEFAULT 'system',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createMarkersTable = `
            CREATE TABLE IF NOT EXISTS route_markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id INTEGER NOT NULL,
                lng REAL NOT NULL,
                lat REAL NOT NULL,
                marker_type TEXT DEFAULT 'important',
                name TEXT NOT NULL,
                description TEXT,
                image_url TEXT,
                contact TEXT,
                importance INTEGER DEFAULT 1,
                category TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE
            )
        `;

        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // 🔁 串行执行：routes → route_markers → users
        db.run(createRoutesTable, function (err) {
            if (err) {
                console.error('❌ 创建 routes 表失败:', err.message);
                return reject(err);
            }
            console.log('✅ routes 表创建完成');

            db.run(createMarkersTable, (err) => {
                if (err) {
                    console.error('❌ 创建 route_markers 表失败:', err.message);
                    return reject(err);
                }
                console.log('✅ route_markers 表创建完成');

                db.run(createUsersTable, (err) => {
                    if (err) {
                        console.error('❌ 创建 users 表失败:', err.message);
                        return reject(err);
                    }
                    console.log('✅ users 表创建完成');
                    resolve(); // 🎉 所有表都建好了，再 resolve
                });
            });
        });
    });
}
// 增强的 ensureAdminUser 函数
    export function ensureAdminUser() {
        return new Promise((resolve, reject) => {
            const adminUsername = 'admin';
            const adminPassword = 'admin123';

            console.log('👑 检查并创建默认用户...');

            // 检查并创建管理员用户
            db.get('SELECT id FROM users WHERE username = ?', [adminUsername], async (err, row) => {
                if (err) return reject(err);

                if (row) {
                    console.log('✅ 管理员用户已存在');
                } else {
                    try {
                        const hash = await bcrypt.hash(adminPassword, 10);
                        db.run(
                            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
                            [adminUsername, hash],
                            function (err) {
                                if (err) {
                                    console.error('❌ 创建管理员用户失败:', err);
                                    reject(err);
                                    return;
                                }
                                console.log('👑 管理员账号创建成功：admin / admin123');
                            }
                        );
                    } catch (error) {
                        reject(error);
                        return;
                    }
                }

                // 管理员处理完成后，创建只读用户
                createReadOnlyUsers()
                    .then(resolve)
                    .catch(reject);
            });
        });
    }
// 创建只读用户函数
// 修复后的 createReadOnlyUsers 函数
// 彻底重写的 createReadOnlyUsers 函数
export function createReadOnlyUsers() {
    return new Promise(async (resolve, reject) => {
        console.log('👤 开始创建只读用户...');

        const readOnlyUsers = [
            { username: 'viewer1', password: 'view123' },
            { username: 'viewer2', password: 'view456' },
            { username: 'viewer3', password: 'view789' }
        ];

        let created = 0;
        let errors = 0;

        try {
            // 使用顺序执行，避免并发问题
            for (const user of readOnlyUsers) {
                try {
                    console.log(`🔄 处理用户: ${user.username}`);

                    // 直接尝试创建，不检查是否存在
                    const hash = await bcrypt.hash(user.password, 10);

                    await new Promise((resolve, reject) => {
                        db.run(
                            'INSERT OR IGNORE INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)',
                            [user.username, hash],
                            function (err) {
                                if (err) {
                                    console.error(`❌ 创建用户 ${user.username} 失败:`, err);
                                    reject(err);
                                } else {
                                    if (this.changes > 0) {
                                        console.log(`✅ 创建用户成功: ${user.username} (ID: ${this.lastID})`);
                                        created++;
                                    } else {
                                        console.log(`ℹ️ 用户 ${user.username} 已存在，跳过创建`);
                                    }
                                    resolve();
                                }
                            }
                        );
                    });

                } catch (error) {
                    console.error(`❌ 处理用户 ${user.username} 时出错:`, error);
                    errors++;
                }
            }

            console.log(`🎉 用户创建完成: 成功 ${created} 个，失败 ${errors} 个`);
            resolve({ created, errors, total: readOnlyUsers.length });

        } catch (error) {
            console.error('❌ 创建只读用户过程出错:', error);
            reject(error);
        }
    });
}


// 保存路线到数据库 (用于 POST/新增)
export function saveRouteToDB(routeData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const {
            name = `路线_${new Date().getTime()}`,
            description = '',
            route_type = 'driving',
            city = '',
            district = '',
            district_type = '区',
            intersections = 0,
            right_turns = 0,
            left_turns = 0,
            u_turns = 0,
            roundabouts = 0,
            special_traffic_lights = 0,
            special_intersections = 0,
            created_by = '路线规划员',
            start_lng,
            start_lat,
            end_lng,
            end_lat,
            waypoints,
            distance = 0,
            duration = 0,
            polyline = '',
            steps = '[]',
            tolls = 0,
            traffic_lights = 0
        } = routeData;

        if (!name || !waypoints || !start_lng || !end_lng) {
            reject(new Error('路线名称、路径点数据和起终点坐标是必填字段'));
            return;
        }

        const sql = `
           INSERT INTO routes (
                name, description, route_type, city, district, district_type,
                intersections, right_turns, left_turns, u_turns, roundabouts,
                special_traffic_lights, special_intersections, created_by,
                start_lng, start_lat, end_lng, end_lat, waypoints, distance, 
                duration, polyline, steps, tolls, traffic_lights
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            name, description, route_type, city, district, district_type,
            intersections, right_turns, left_turns, u_turns, roundabouts,
            special_traffic_lights, special_intersections, created_by,
            start_lng, start_lat, end_lng, end_lat, waypoints, distance,
            duration, polyline, steps, tolls, traffic_lights
        ];

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: this.lastID, ...routeData });
            }
        });
    });
}

// 获取路线列表
export function getRoutesFromDB(filters = {}) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const { page = 1, limit = 20, type, search } = filters;
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM routes WHERE 1=1';
        let params = [];

        if (type) {
            query += ' AND route_type = ?';
            params.push(type);
        }

        if (search) {
            query += ' AND name LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const routes = rows.map(route => ({
                    ...route,
                    waypoints: route.waypoints ? JSON.parse(route.waypoints) : [],
                    steps: route.steps ? JSON.parse(route.steps) : [],
                    polyline: route.polyline || '',
                    creator: route.created_by,
                    city: route.city || '',
                    district: route.district || '',
                    district_type: route.district_type || '区',
                    intersections: route.intersections || 0,
                    right_turns: route.right_turns || 0,
                    left_turns: route.left_turns || 0,
                    u_turns: route.u_turns || 0,
                    roundabouts: route.roundabouts || 0,
                    special_traffic_lights: route.special_traffic_lights || 0,
                    special_intersections: route.special_intersections || 0
                }));
                resolve(routes);
            }
        });
    });
}

// 根据ID获取路线
export function getRouteByIdFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const sql = 'SELECT * FROM routes WHERE id = ?';

        db.get(sql, [id], (err, row) => {
            if (err) {
                reject(err);
            } else if (!row) {
                reject(new Error('路线不存在'));
            } else {
                const route = {
                    ...row,
                    waypoints: row.waypoints ? JSON.parse(row.waypoints) : [],
                    steps: row.steps ? JSON.parse(row.steps) : [],
                    polyline: row.polyline || '',
                    creator: row.created_by,
                    city: row.city || '',
                    district: row.district || '',
                    district_type: row.district_type || '区',
                    intersections: row.intersections || 0,
                    right_turns: row.right_turns || 0,
                    left_turns: row.left_turns || 0,
                    u_turns: row.u_turns || 0,
                    roundabouts: row.roundabouts || 0,
                    special_traffic_lights: row.special_traffic_lights || 0,
                    special_intersections: row.special_intersections || 0
                };
                resolve(route);
            }
        });
    });
}

// 更新路线 (用于 PUT/更新)
export function updateRouteInDB(id, updates) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        // <--- **修复点：允许更新所有地理信息和计算信息**
        const allowedFields = [
            'name', 'description', 'route_type', 'city', 'district', 'district_type',
            'intersections', 'right_turns', 'left_turns', 'u_turns', 'roundabouts',
            'special_traffic_lights', 'special_intersections', 'created_by',
            'start_lng', 'start_lat', 'end_lng', 'end_lat', 'waypoints', 'distance',
            'duration', 'polyline', 'steps', 'tolls', 'traffic_lights'
        ];
        // ---> 修复点结束

        const updateFields = [];
        const params = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                // 排除 creator 字段，除非明确更新，我们主要用 created_by
                if (key === 'description') {
                    // 前端发送的 route_description 对应数据库的 description
                    updateFields.push(`description = ?`);
                    params.push(updates[key]);
                } else if (key === 'creator') {
                    // 前端发送的 creator 对应数据库的 created_by
                    updateFields.push(`created_by = ?`);
                    params.push(updates[key]);
                } else {
                    updateFields.push(`${key} = ?`);
                    params.push(updates[key]);
                }
            }
        });

        if (updateFields.length === 0) {
            reject(new Error('没有有效的更新字段'));
            return;
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        const sql = `UPDATE routes SET ${updateFields.join(', ')} WHERE id = ?`;

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                // 如果是更新，则不返回新的 lastID，只返回更新结果
                resolve({ id, changes: this.changes });
            }
        });
    });
}

// 删除路线 (逻辑不变)
export function deleteRouteFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const sql = 'DELETE FROM routes WHERE id = ?';

        db.run(sql, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id, changes: this.changes });
            }
        });
    });
}

// 获取路线统计信息 (逻辑不变)
export function getRouteStatsFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const sql = `
            SELECT 
                COUNT(*) as total_routes,
                SUM(distance) as total_distance,
                AVG(distance) as avg_distance,
                route_type,
                COUNT(*) as type_count
            FROM routes 
            GROUP BY route_type
        `;

        db.all(sql, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// 关闭数据库连接 (逻辑不变)
export function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        if (db) {
            db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('✅ 数据库连接已关闭');
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

// 重要标记点数据库操作
export function saveRouteMarkerToDB(routeId, markerData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const {
            lng, lat, marker_type = 'important', name, description = '',
            image_url = '', contact = '', importance = 1, category = 'other'
        } = markerData;

        if (!lng || !lat || !name) {
            reject(new Error('经纬度和名称为必填字段'));
            return;
        }

        const sql = `
            INSERT INTO route_markers 
            (route_id, lng, lat, marker_type, name, description, image_url, contact, importance, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [routeId, lng, lat, marker_type, name, description, image_url, contact, importance, category];

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({
                    id: this.lastID,
                    route_id: routeId,
                    ...markerData
                });
            }
        });
    });
}

export function getRouteMarkersFromDB(routeId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const sql = 'SELECT * FROM route_markers WHERE route_id = ? ORDER BY importance DESC, created_at DESC';

        db.all(sql, [routeId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

export function updateRouteMarkerInDB(markerId, updates) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const allowedFields = ['name', 'description', 'image_url', 'contact', 'importance', 'category', 'marker_type'];
        const updateFields = [];
        const params = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                params.push(updates[key]);
            }
        });

        if (updateFields.length === 0) {
            reject(new Error('没有有效的更新字段'));
            return;
        }

        params.push(markerId);
        const sql = `UPDATE route_markers SET ${updateFields.join(', ')} WHERE id = ?`;

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: markerId, changes: this.changes });
            }
        });
    });
}

export function deleteRouteMarkerFromDB(markerId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }
        const sql = 'DELETE FROM route_markers WHERE id = ?';

        db.run(sql, [markerId], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: markerId, changes: this.changes });
            }
        });
    });
}

// 搜索路线 - 修复函数定义和导出
export function searchRoutesFromDB(filters) {
    return new Promise((resolve, reject) => {
        const {
            keyword = '',
            page = 1,
            limit = 20
        } = filters;

        console.log('🔍 数据库搜索参数:', filters);

        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM routes';
        let params = [];

        if (keyword && keyword.trim() !== '') {
            query += ' WHERE name LIKE ? OR description LIKE ? OR city LIKE ? OR district LIKE ? OR created_by LIKE ?';
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
            console.log(`✅ 添加关键词条件: ${keyword}`);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        // 获取总数
        let countQuery = 'SELECT COUNT(*) as total FROM routes';
        let countParams = [];

        if (keyword && keyword.trim() !== '') {
            countQuery += ' WHERE name LIKE ? OR description LIKE ? OR city LIKE ? OR district LIKE ? OR created_by LIKE ?';
            countParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        }

        console.log('📋 数据查询SQL:', query);
        console.log('📋 计数查询SQL:', countQuery);
        console.log('🔢 查询参数:', params);

        // 先查询总数
        db.get(countQuery, countParams, (err, countResult) => {
            if (err) {
                console.error('❌ 查询总数失败:', err);
                reject(err);
                return;
            }

            const total = countResult.total || 0;
            console.log(`📊 查询到总数: ${total}`);

            if (total === 0) {
                console.log('ℹ️ 没有找到匹配的记录');
                resolve({ routes: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
                return;
            }

            // 查询数据
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ 查询数据失败:', err);
                    reject(err);
                } else {
                    console.log(`✅ 查询成功，返回 ${rows.length} 条记录`);

                    const routes = rows.map(route => {
                        try {
                            return {
                                ...route,
                                waypoints: route.waypoints ? JSON.parse(route.waypoints) : [],
                                steps: route.steps ? JSON.parse(route.steps) : [],
                                polyline: route.polyline || '',
                                creator: route.created_by || '系统',
                                city: route.city || '',
                                district: route.district || '',
                                district_type: route.district_type || '区',
                                intersections: route.intersections || 0,
                                right_turns: route.right_turns || 0,
                                left_turns: route.left_turns || 0,
                                u_turns: route.u_turns || 0,
                                roundabouts: route.roundabouts || 0,
                                special_traffic_lights: route.special_traffic_lights || 0,
                                special_intersections: route.special_intersections || 0
                            };
                        } catch (parseError) {
                            console.error('❌ 解析路线数据失败:', parseError);
                            return route;
                        }
                    });

                    resolve({
                        routes,
                        total,
                        page: parseInt(page),
                        limit: parseInt(limit)
                    });
                }
            });
        });
    });
}

export function testDatabaseSearch() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未连接'));
            return;
        }

        // 测试1: 查询数据库中的路线总数
        const testSql = 'SELECT COUNT(*) as total FROM routes';

        db.get(testSql, [], (err, result) => {
            if (err) {
                reject(err);
            } else {
                console.log('🧪🧪 数据库测试 - 路线总数:', result.total);

                // 如果有数据，显示前几条
                if (result.total > 0) {
                    const sampleSql = 'SELECT id, name, route_type FROM routes ORDER BY created_at DESC LIMIT 5';
                    db.all(sampleSql, [], (err, rows) => {
                        if (err) {
                            console.error('查询示例数据失败:', err);
                        } else {
                            console.log('🧪🧪 数据库中的路线示例:');
                            rows.forEach((row, index) => {
                                console.log(`  ${index + 1}. ID: ${row.id}, 名称: "${row.name}", 类型: ${row.route_type}`);
                            });
                        }
                        resolve(result);
                    });
                } else {
                    console.log('⚠️ 数据库中没有任何路线数据');
                    resolve(result);
                }
            }
        });
    });
}



// 统一导出所有函数
export default {
    initDatabase,
    saveRouteToDB,
    getRoutesFromDB,
    getRouteByIdFromDB,
    updateRouteInDB,
    deleteRouteFromDB,
    getRouteStatsFromDB,
    closeDatabase,
    saveRouteMarkerToDB,
    getRouteMarkersFromDB,
    updateRouteMarkerInDB,
    deleteRouteMarkerFromDB,
    searchRoutesFromDB,
    testDatabaseSearch,
    createReadOnlyUsers
};