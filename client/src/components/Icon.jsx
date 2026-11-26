const paths = {
  settings: 'M10 2.5h4l.6 2.4 1.6.9 2.4-.7 2 3.5-1.8 1.8v1.8l1.8 1.8-2 3.5-2.4-.7-1.6.9-.6 2.5h-4l-.6-2.5-1.6-.9-2.4.7-2-3.5 1.8-1.8v-1.8L3.4 8.6l2-3.5 2.4.7 1.6-.9zM15 11.4a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20.8 15.1A9 9 0 0 1 8.9 3.2 9 9 0 1 0 20.8 15.1Z',
  back: 'm14 6-6 6 6 6',
  connection: 'M4 6h16M4 12h16M4 18h16M8 3v6m7 0v6m-5 0v6',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm9 3v6m-3-3h6',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'm6 6 12 12M18 6 6 18',
  down: 'm6 9 6 6 6-6',
  link: 'M10 13.5a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.7l-1.7 1.7m2.7 4a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.7l1.7-1.7',
  forward: 'm10 6 6 6-6 6',
};

export default function Icon({ name }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} strokeWidth={name === 'more' ? 2.8 : undefined} /></svg>;
}
