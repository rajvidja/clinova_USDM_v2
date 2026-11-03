import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { BuilderHome } from './pages/builder/BuilderHome';
import { Editor } from './pages/builder/Editor';
import { NewProtocol } from './pages/builder/NewProtocol';
import { Templates } from './pages/builder/Templates';
import { Dashboard } from './pages/Dashboard';
import { Digitisation } from './pages/Digitisation';
import { OcrReview } from './pages/OcrReview';
import { ExportCenter, Explorer, RelationshipMap, Review, SoaModule } from './pages/Modules';
import { Studies } from './pages/Studies';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="studies" element={<Studies />} />
          <Route path="digitisation" element={<Digitisation />} />
          <Route path="digitisation/ocr/:id" element={<OcrReview />} />
          <Route path="builder" element={<BuilderHome />} />
          <Route path="builder/new" element={<NewProtocol />} />
          <Route path="builder/templates" element={<Templates />} />
          <Route path="builder/:id/:tab?" element={<Editor />} />
          <Route path="explorer/:id?" element={<Explorer />} />
          <Route path="soa/:id?" element={<SoaModule />} />
          <Route path="relationships/:id?" element={<RelationshipMap />} />
          <Route path="review/:id?" element={<Review />} />
          <Route path="export/:id?" element={<ExportCenter />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
