export default function RequestAddress({ address }) {
  return (
    <output className="request-address" aria-label="连接地址" title={address || undefined}>
      {address || '未配置地址'}
    </output>
  );
}
