/** 官方 UI 案例的服务端演示数据。所有记录仅用于可复现的交互演示。 */
const tickets = [
    { id: 'REQ-1048', subject: '导出报表缺少上周数据', priority: 'high', status: 'open', owner: '陈薇', updated: '09:42', context: '财务团队导出的周报缺少上周一至周三的数据，需要核对筛选范围。' },
    { id: 'REQ-1047', subject: '新成员无法访问项目', priority: 'medium', status: 'in-progress', owner: '林梅', updated: '09:18', context: '项目管理员已邀请新成员，成员仍然无法打开项目工作区。' },
    { id: 'REQ-1046', subject: '审批通知发送延迟', priority: 'high', status: 'open', owner: '周宁', updated: '昨天', context: '审批完成后，部分成员收到通知的时间晚于预期。' },
    { id: 'REQ-1045', subject: '调整团队默认时区', priority: 'low', status: 'resolved', owner: '陈薇', updated: '昨天', context: '团队希望新项目默认使用上海时区。' },
    { id: 'REQ-1044', subject: '发票下载入口不明显', priority: 'medium', status: 'in-progress', owner: '林梅', updated: '周一', context: '管理员在账单页面难以找到历史发票下载入口。' },
    { id: 'REQ-1043', subject: '移动端筛选条件未保留', priority: 'medium', status: 'open', owner: '周宁', updated: '周一', context: '从列表进入详情再返回后，移动端筛选条件被重置。' },
];

const english = {
    'REQ-1048': ['Weekly export is missing data', 'Finance exports exclude the first three days of last week. Check the selected date range.'],
    'REQ-1047': ['New member cannot open a project', 'The administrator invited a teammate, but the project workspace remains inaccessible.'],
    'REQ-1046': ['Approval notification is delayed', 'Some members receive an approval notice later than expected.'],
    'REQ-1045': ['Change the team default time zone', 'The team wants new projects to use Shanghai time by default.'],
    'REQ-1044': ['Invoice download is hard to find', 'Administrators cannot easily find historical invoices on the billing page.'],
    'REQ-1043': ['Mobile filters do not persist', 'Returning from a detail view resets filters on mobile.'],
};

export default class TicketDemo {
    list(locale: string = 'zh-hans') {
        const isEnglish = locale === 'en-us';
        return tickets.map((ticket) => {
            const translated = english[ticket.id as keyof typeof english];
            return {
                ...ticket,
                subject: isEnglish ? translated[0] : ticket.subject,
                context: isEnglish ? translated[1] : ticket.context,
                owner: isEnglish ? ({ '陈薇': 'Chen Wei', '林梅': 'Lin Mei', '周宁': 'Zhou Ning' }[ticket.owner] ?? ticket.owner) : ticket.owner,
                updated: isEnglish && ticket.updated === '昨天' ? 'Yesterday' : isEnglish && ticket.updated === '周一' ? 'Monday' : ticket.updated,
            };
        });
    }
}
