import "./vendor/bootstrap.min.css";
import * as bootstrap from "bootstrap/dist/js/bootstrap.esm.js";
import "./styles/dashboard.css";
import "./styles/market-board.css";
import "./styles/chip-workspace.css";
import "./styles/assistant.css";
import { initAssistantController } from "./controllers/chat-controller.js";
import { initMarketBoardController } from "./controllers/market-board-controller.js";
import { initMediaController } from "./controllers/media-controller.js";
import { initStockModel, state } from "./models/stock-model.js";
import {
  initDashboardView,
  renderAnalysis,
  plot,
} from "./views/dashboard-view.js";
import { initResearchView } from "./views/research-view.js";
import {
  initFinancialView,
  renderFinancialResearch,
} from "./views/financial-view.js";
import {
  initFinancialChart,
  financialLinePath,
} from "./views/financial-chart.js";
import {
  initDashboardController,
  selectBar,
} from "./controllers/dashboard-controller.js";
import {
  initAnalysisController,
  selectSection,
} from "./controllers/analysis-controller.js";
import { initResearchController } from "./controllers/research-controller.js";
import {
  initUtilityController,
  calcSettings,
  calculatorContext,
} from "./controllers/utility-controller.js";

// Modules declare their dependencies explicitly; DOM binding begins after loading.
initStockModel();
initDashboardView();
initResearchView();
initFinancialView();
initFinancialChart();
initDashboardController();
initAnalysisController();
initResearchController();
initUtilityController();
initMarketBoardController();
initMediaController();
initAssistantController();

// Small integration surface for browser verification and future assistant clients.
globalThis.stockCoach = {
  bootstrap,
  state,
  selectSection,
  selectBar,
  renderAnalysis,
  plot,
  renderFinancialResearch,
  financialLinePath,
  calcSettings,
  get peerData() {
    return calculatorContext.peerData;
  },
  get calcChosenChange() {
    return calculatorContext.change;
  },
  set calcChosenChange(value) {
    calculatorContext.change = value;
  },
  get calcChosenTicks() {
    return calculatorContext.ticks;
  },
  set calcChosenTicks(value) {
    calculatorContext.ticks = value;
  },
};
