export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-50 gap-8">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl text-center">
        <h1 className="text-4xl font-bold text-slate-800 mb-4">Pembaca Website & Github</h1>
        <p className="text-slate-600 mb-8">
          Tahan tombol <strong>Alt</strong> (atau Option) pada keyboard Anda dan arahkan kursor ke elemen manapun di halaman ini. Klik elemen tersebut untuk langsung menuju ke file source code-nya di GitHub!
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
          <section className="p-6 bg-blue-50 border border-blue-100 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
            <h2 className="font-semibold text-blue-800 mb-2">Komponen Card A</h2>
            <p className="text-sm text-blue-600">Coba Alt+Click pada kotak biru ini. Webpack loader kami telah menyuntikkan data-github-source ke elemen ini secara otomatis.</p>
          </section>
          
          <section className="p-6 bg-emerald-50 border border-emerald-100 rounded-lg cursor-pointer hover:bg-emerald-100 transition-colors">
            <h2 className="font-semibold text-emerald-800 mb-2">Komponen Card B</h2>
            <p className="text-sm text-emerald-600">Alat ini menjembatani gap antara tampilan visual (DOM) dan source code di repositori.</p>
          </section>
        </div>
      </div>
      
      <footer className="text-slate-500 text-sm">
        <p>Proyek eksperimental oleh Persiapantubel</p>
      </footer>
    </main>
  );
}