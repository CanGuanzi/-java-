// services/amapService.js
import axios from 'axios';

export class AMapService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://restapi.amap.com/v3';
    }

    /**
     * 调用高德地图Web服务API进行驾车路径规划
     * @param {{lng: number, lat: number}} origin 起点坐标
     * @param {{lng: number, lat: number}} destination 终点坐标
     * @param {Array<{lng: number, lat: number}>} waypoints 途径点数组
     * @param {string} strategy 路径规划策略 (0:最快, 1:最短, 2:避高速等)
     */
    async planDrivingRoute(origin, destination, waypoints = [], strategy = "0") {
        try {
            console.log('🚀 调用真实高德API进行路径规划');
            
            const params = {
                key: this.apiKey,
                origin: `${origin.lng},${origin.lat}`,
                destination: `${destination.lng},${destination.lat}`,
                strategy: strategy, // 0:最快路线 1:最短路程 2:避免高速
                extensions: 'all',
                output: 'JSON'
            };

            // 添加途径点
            if (waypoints && waypoints.length > 0) {
                params.waypoints = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
            }

            console.log('📡 请求参数:', params);

            const response = await axios.get(`${this.baseURL}/direction/driving`, { 
                params,
                timeout: 10000
            });
            
            const data = response.data;
            console.log('✅ 高德API响应:', data);

            if (data.status !== '1') {
                throw new Error(`高德API错误: ${data.info || '未知错误'}`);
            }

            return this.parseRealRouteData(data);
            
        } catch (error) {
            // 在这里捕获的错误会带上堆栈信息，并被传递到 routeService
            console.error('❌ 高德API调用失败:', error.message);
            throw error;
        }
    }

    /**
     * 调用高德地图Web服务API进行地理编码（地址转坐标）
     * @param {string} address 地址
     * @param {string} city 城市
     */
    async geocode(address, city = null) {
        // ... (假设 geocode 函数没有问题)
        throw new Error("Geocode 功能未在此示例中完整实现，请自行检查其健壮性。");
    }

    /**
     * 调用高德地图Web服务API进行逆地理编码（坐标转地址）
     * @param {number} lng 经度
     * @param {number} lat 纬度
     */
    async reverseGeocode(lng, lat) {
        // ... (假设 reverseGeocode 函数没有问题)
        throw new Error("ReverseGeocode 功能未在此示例中完整实现，请自行检查其健壮性。");
    }

    /**
     * 解析高德API返回的路径规划数据
     * @param {Object} data 高德API响应的JSON数据
     * @returns {Object} 统一格式的路线数据
     */
    parseRealRouteData(data) {
        const route = data.route;
        
        // 健壮性检查 1: 确保路径存在
        if (!route || !route.paths || route.paths.length === 0) {
            console.error('❌ 高德API返回成功，但未找到可规划的路径。请检查起点、终点是否可达。');
            throw new Error('高德API返回成功，但未找到可规划的路径。请检查起点、终点是否在中国大陆可达，或起点终点是否重叠。');
        }

        const path = route.paths[0]; // 取第一条路径
        
        // 【⭐ 核心修复：聚合所有步骤的 Polyline】
        let aggregatedPolyline = path.polyline; // 尝试获取顶层 Polyline
        
        // 如果顶层 Polyline 为空或缺失，则从 steps 中拼接
        if (!aggregatedPolyline || aggregatedPolyline.length === 0) {
            // 从每个步骤中提取 polyline 并用分号连接
            aggregatedPolyline = path.steps
                .map(step => step.polyline)
                .filter(p => p && p.length > 0)
                .join(';');
        }
        
        // 解析路线步骤
        const steps = path.steps.map(step => ({
            instruction: step.instruction.replace(/<[^>]*>/g, ''), // 清理HTML标签
            distance: (step.distance / 1000).toFixed(1),
            time: Math.ceil(step.duration / 60),
            road: step.road || '',
            orientation: step.orientation || ''
        }));

        return {
            distance: (path.distance / 1000).toFixed(1), // 转为公里
            time: Math.ceil(path.duration / 60), // 转为分钟
            tolls: path.tolls || 0, // 过路费
            traffic_lights: path.traffic_lights || 0,
            steps: steps,
            // 使用聚合后的 Polyline
            polyline: this.decodePolyline(aggregatedPolyline), 
            bounds: this.calculateBounds(aggregatedPolyline), // 使用聚合后的 Polyline
            source: '高德地图真实API'
        };
    }

    /**
     * 解码高德返回的Polyline字符串为坐标数组
     * @param {string} polyline 
     * @returns {Array<Array<number>>} [[lng1, lat1], [lng2, lat2], ...]
     */
    decodePolyline(polyline) {
        // 健壮性检查 2: 防止对 undefined/null/空字符串调用 split()
        if (!polyline || typeof polyline !== 'string' || polyline.length === 0) {
             console.warn('Polyline数据为空，无法解码');
             return [];
        }

        try {
            return polyline.split(';').map(point => {
                const [lng, lat] = point.split(',');
                return [parseFloat(lng), parseFloat(lat)];
            });
        } catch (error) {
            console.warn('Polyline解码失败，使用简化路径');
            return [];
        }
    }

    /**
     * 根据Polyline计算路线的边界（西南角和东北角）
     * @param {string} polyline 
     * @returns {{southwest: {lng: number, lat: number}, northeast: {lng: number, lat: number}}} 边界对象
     */
    calculateBounds(polyline) {
        // 健壮性检查 3: 防止对 undefined/null/空字符串调用 split()
        if (!polyline || typeof polyline !== 'string' || polyline.length === 0) {
            console.warn('Polyline数据为空，无法计算边界');
            return null; 
        }

        // 原始逻辑：对非空字符串进行处理
        const points = polyline.split(';').map(point => {
            const [lng, lat] = point.split(',').map(Number);
            return { lng, lat };
        });
        
        const lngs = points.map(p => p.lng);
        const lats = points.map(p => p.lat);
        
        const southwest = { lng: Math.min(...lngs), lat: Math.min(...lats) };
        const northeast = { lng: Math.max(...lngs), lat: Math.max(...lats) };

        return { southwest, northeast };
    }
}