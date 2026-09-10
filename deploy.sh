#!/bin/bash
# 小黑盒收藏助手 - 快速部署脚本
# 用法: chmod +x deploy.sh && ./deploy.sh

set -e

echo "========================================="
echo "  小黑盒收藏助手 - Docker 快速部署"
echo "========================================="
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "[错误] 未检测到 Docker，请先安装 Docker"
    echo "安装命令: curl -fsSL https://get.docker.com | sudo sh"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! docker compose version &> /dev/null; then
    echo "[错误] 未检测到 Docker Compose"
    exit 1
fi

echo "[1/5] 检查环境..."
docker --version
docker compose version
echo ""

# 创建必要目录
echo "[2/5] 创建数据目录..."
mkdir -p data media logs
echo "  - data/   (数据库)"
echo "  - media/  (图片)"
echo "  - logs/   (日志)"
echo ""

# 停止旧容器（如果存在）
echo "[3/5] 停止旧容器（如果存在）..."
docker compose down 2>/dev/null || true
echo ""

# 构建并启动
echo "[4/5] 构建镜像并启动容器（首次需要 5-10 分钟）..."
docker compose up -d --build
echo ""

# 等待应用启动
echo "[5/5] 等待应用启动..."
sleep 5

# 检查容器状态
echo ""
echo "========================================="
echo "  部署完成！"
echo "========================================="
echo ""
docker compose ps
echo ""

# 获取服务器 IP
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "访问地址:"
echo "  本地: http://localhost:3000/app/"
echo "  网络: http://${SERVER_IP}:3000/app/"
echo ""
echo "常用命令:"
echo "  查看日志: docker compose logs -f"
echo "  重启:     docker compose restart"
echo "  停止:     docker compose down"
echo "  启动:     docker compose up -d"
echo ""
echo "如果无法访问，请检查防火墙是否开放 3000 端口:"
echo "  sudo ufw allow 3000/tcp"
echo ""
