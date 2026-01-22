import { AMapService } from './amapService.js';

// 初始化高德服务 - 使用环境变量中的API Key
const amapService = new AMapService(process.env.AMAP_API_KEY || '您的默认API_Key');

export class RouteService {
    async planRoute(points, routeType = "driving", strategy = "0") {
        try {
            if (!points || points.length < 2) {
                throw new Error('至少需要起点和终点2个路径点');
            }

            const origin = { lng: points[0].lng, lat: points[0].lat };
            const destination = { lng: points[points.length-1].lng, lat: points[points.length-1].lat };
            const waypoints = points.slice(1, points.length-1);

            console.log('路径规划请求:', {
                起点: origin,
                终点: destination,
                途径点数量: waypoints.length,
                策略: strategy
            });

            const routeData = await amapService.planDrivingRoute(origin, destination, waypoints, strategy);
            
            return {
                success: true,
                data: {
                    ...routeData,
                    points: points,
                    routeType: routeType,
                    strategy: strategy,
                    calculatedAt: new Date().toISOString()
                }
            };
            
        } catch (error) {
            console.error('路径规划错误:', error);
            throw new Error(`路径规划失败: ${error.message}`);
        }
    }

    async geocodeAddress(address, city = null) {
        try {
            const result = await amapService.geocode(address, city);
            return {
                success: true,
                data: result
            };
        } catch (error) {
            throw new Error(`地址解析失败: ${error.message}`);
        }
    }

    async reverseGeocode(lng, lat) {
        try {
            const result = await amapService.reverseGeocode(lng, lat);
            return {
                success: true,
                data: result
            };
        } catch (error) {
            throw new Error(`坐标解析失败: ${error.message}`);
        }
    }
}

export const routeService = new RouteService();