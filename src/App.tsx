import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { GameProvider, useGame } from './context/GameContext'
import SignInPage from './pages/SignInPage'
import PoolSelectionPage from './pages/PoolSelectionPage'
import InstructionsPage from './pages/InstructionsPage'
import PlayingPage from './pages/PlayingPage'
import ResultsPage from './pages/ResultsPage'
import StationAvatar from './components/StationAvatar'
import OperatorGate from './components/OperatorGate'
import QuestionLoadingPage from './pages/QuestionLoadingPage'

function PlayerRoutes() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, isPlaying, savedSummary } = useGame()
  const lockedPath = isPlaying ? '/playing' : session && !savedSummary ? '/results' : null
  useEffect(() => {
    if (lockedPath && location.pathname !== lockedPath) navigate(lockedPath, { replace: true })
  }, [lockedPath, location.pathname, navigate])

  return (
    <Routes location={lockedPath ?? location}>
      <Route path="/" element={<Navigate to="/signin" replace />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/select-pool" element={<PoolSelectionPage />} />
      <Route path="/instructions" element={<InstructionsPage />} />
      <Route path="/playing" element={<PlayingPage />} />
      <Route path="/results" element={<ResultsPage />} />
      {/* OperatorGate renders this page without unmounting children during sign-in recovery. */}
      <Route path="/operator" element={null} />
      <Route path="/questions/load" element={<QuestionLoadingPage />} />
      <Route path="/auth/callback" element={<Navigate to="/signin" replace />} />
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <GameProvider>
      <Router>
        <OperatorGate>
          <StationAvatar />
          <div className="relative z-10 min-h-screen bg-blue-500">
            <PlayerRoutes />
          </div>
        </OperatorGate>
      </Router>
    </GameProvider>
  )
}

export default App
