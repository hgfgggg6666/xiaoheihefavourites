#!/bin/bash
# 小黑盒收藏助手 - 数据迁移脚本
# 用于把本地电脑的数据迁移到服务器
#
# 用法:
#   1. 在本地电脑执行: ./migrate-data.sh pack
#   2. 把生成的 backup.tar.gz 上传到服务器
#   3. 在服务器执行: ./migrate-data.sh unpack
#   4. 重启容器: docker compose restart

set -e

ACTION=${1:-help}

case $ACTION in
    pack)
        echo "========================================="
        echo "  打包本地数据"
        echo "========================================="
        echo ""

        # 检查目录是否存在
        if [ ! -d "data" ] && [ ! -d "media" ]; then
            echo "[警告] 未找到 data 或 media 目录"
            echo "请确保在项目根目录下执行此脚本"
            exit 1
        fi

        # 创建备份
        BACKUP_FILE="xiaoheihe-data-$(date +%Y%m%d-%H%M%S).tar.gz"
        echo "正在打包数据到 ${BACKUP_FILE}..."

        # 只打包存在的目录
        TAR_ARGS=""
        [ -d "data" ] && TAR_ARGS="$TAR_ARGS data"
        [ -d "media" ] && TAR_ARGS="$TAR_ARGS media"
        [ -d "logs" ] && TAR_ARGS="$TAR_ARGS logs"

        tar -czf "$BACKUP_FILE" $TAR_ARGS

        echo ""
        echo "打包完成！文件大小: $(du -h "$BACKUP_FILE" | cut -f1)"
        echo ""
        echo "下一步:"
        echo "  1. 把 ${BACKUP_FILE} 上传到服务器项目目录"
        echo "     scp ${BACKUP_FILE} user@server-ip:/path/to/xiaoheihefavourites/"
        echo "  2. 在服务器上执行: ./migrate-data.sh unpack ${BACKUP_FILE}"
        echo "  3. 重启容器: docker compose restart"
        ;;

    unpack)
        BACKUP_FILE=${2:-}

        if [ -z "$BACKUP_FILE" ]; then
            # 自动查找最新的备份文件
            BACKUP_FILE=$(ls -t xiaoheihe-data-*.tar.gz 2>/dev/null | head -1)
        fi

        if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
            echo "[错误] 未找到备份文件"
            echo "用法: ./migrate-data.sh unpack <backup-file.tar.gz>"
            exit 1
        fi

        echo "========================================="
        echo "  恢复数据到服务器"
        echo "========================================="
        echo ""
        echo "备份文件: $BACKUP_FILE"
        echo ""

        # 停止容器
        echo "停止容器..."
        docker compose down 2>/dev/null || true

        # 备份当前数据（如果存在）
        if [ -d "data" ] || [ -d "media" ]; then
            echo "备份当前数据..."
            tar -czf "backup-before-migration-$(date +%Y%m%d-%H%M%S).tar.gz" data media 2>/dev/null || true
        fi

        # 解压备份
        echo "恢复数据..."
        tar -xzf "$BACKUP_FILE"

        # 设置权限
        echo "设置文件权限..."
        chmod -R 755 data media logs 2>/dev/null || true

        echo ""
        echo "数据恢复完成！"
        echo ""
        echo "下一步:"
        echo "  1. 启动容器: docker compose up -d"
        echo "  2. 查看日志: docker compose logs -f"
        echo "  3. 访问应用: http://your-server-ip:3000/app/"
        ;;

    *)
        echo "小黑盒收藏助手 - 数据迁移脚本"
        echo ""
        echo "用法:"
        echo "  ./migrate-data.sh pack      打包本地数据"
        echo "  ./migrate-data.sh unpack    恢复数据到服务器（自动查找最新备份）"
        echo "  ./migrate-data.sh unpack xxx.tar.gz  恢复指定备份文件"
        echo ""
        echo "示例:"
        echo "  # 本地电脑执行"
        echo "  ./migrate-data.sh pack"
        echo ""
        echo "  # 上传到服务器"
        echo "  scp xiaoheihe-data-*.tar.gz user@server:/path/to/project/"
        echo ""
        echo "  # 服务器执行"
        echo "  ./migrate-data.sh unpack"
        echo "  docker compose up -d"
        ;;
esac
